import { test, expect, type Locator, type Page } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

// These journeys include several windows, browser downloads and a full refresh.
// Reduced motion also exercises the accessible static scene during controls QA.
test.use({ reducedMotion: 'reduce' });
test.setTimeout(90000);

type Provider = 'Claude' | 'Codex' | 'ChatGPT';
function chatWindow(page: Page, provider: Provider, title: string) {
  return page.getByRole('region', { name: `${provider} chat window`, exact: true }).filter({ has: page.getByRole('textbox', { name: `Rename ${title}`, exact: true }) });
}
const savedChats = (page: Page) => page.getByLabel('Saved chat windows', { exact: true });

async function launchAgent(page: Page, provider: 'Claude' | 'Codex', text: string) {
  const composer = page.getByRole('region', { name: 'Command composer', exact: true });
  await composer.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(provider.toLowerCase());
  await composer.getByRole('textbox', { name: 'Your prompt', exact: true }).fill(text);
  await composer.getByRole('button', { name: 'Send message', exact: true }).click();
  const window = chatWindow(page, provider, text);
  await expect(window).toBeVisible();
  await expect(window.getByRole('region', { name: 'Latest agent response', exact: true })).toContainText(`${provider} chat response: ${text}`);
  return window;
}

async function launchChatGPT(page: Page, mode: 'General chat' | 'Create image') {
  await page.getByRole('button', { name: 'ChatGPT tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ChatGPT tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: mode, exact: true }).click();
  const window = chatWindow(page, 'ChatGPT', mode === 'General chat' ? 'New ChatGPT chat' : 'New image studio');
  await expect(window).toBeVisible();
  await expect(window.getByRole('combobox', { name: 'ChatGPT chat mode', exact: true })).toHaveValue(mode === 'General chat' ? 'chat' : 'image');
  return window;
}

async function expectInsideViewport(page: Page, window: Locator) {
  const box = await window.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

for (const provider of ['Claude', 'Codex'] as const) {
  test(`main composer creates independent ${provider} windows and follow-ups stay in their own chat`, async ({ page }) => {
    await openWorkspace(page);
    const firstTitle = `${provider} first conversation`, secondTitle = `${provider} second conversation`;
    const first = await launchAgent(page, provider, firstTitle);
    await first.getByRole('button', { name: `Context for ${firstTitle}`, exact: true }).click();
    await first.getByRole('checkbox', { name: `Use Architecture in ${firstTitle}`, exact: true }).check();
    await first.getByRole('button', { name: `Context for ${firstTitle}`, exact: true }).click();
    const followUpMode = provider === 'Claude' ? 'plan' : 'build';
    await first.getByRole('combobox', { name: `${provider} chat mode`, exact: true }).selectOption(followUpMode);
    await first.getByRole('textbox', { name: `Message ${provider} in ${firstTitle}`, exact: true }).fill('A follow-up only for the first chat');
    await first.getByRole('button', { name: `Send to ${provider}`, exact: true }).click();
    await expect(first.getByRole('region', { name: 'Latest agent response', exact: true })).toContainText(`${provider} ${followUpMode} response: A follow-up only for the first chat`);

    const second = await launchAgent(page, provider, secondTitle);
    await expect(page.getByRole('region', { name: `${provider} chat window`, exact: true })).toHaveCount(2);
    await expect(second).not.toContainText('A follow-up only for the first chat');
    await expect(first).not.toContainText(secondTitle);
    await expect(second.getByRole('combobox', { name: `${provider} chat mode`, exact: true })).toHaveValue('chat');
    await second.getByRole('button', { name: `Context for ${secondTitle}`, exact: true }).click();
    await expect(second.getByRole('checkbox', { name: `Use Architecture in ${secondTitle}`, exact: true })).not.toBeChecked();
    await second.getByRole('button', { name: `Context for ${secondTitle}`, exact: true }).click();
    await second.getByRole('textbox', { name: `Message ${provider} in ${secondTitle}`, exact: true }).fill('An unsent second-chat draft');

    await savedChats(page).getByRole('button', { name: `Open saved ${provider} chat ${firstTitle}`, exact: true }).click();
    await expect(first.getByRole('textbox', { name: `Message ${provider} in ${firstTitle}`, exact: true })).toHaveValue('');
    await expect(first).toContainText('A follow-up only for the first chat');
    await savedChats(page).getByRole('button', { name: `Open saved ${provider} chat ${secondTitle}`, exact: true }).click();
    await expect(second.getByRole('textbox', { name: `Message ${provider} in ${secondTitle}`, exact: true })).toHaveValue('An unsent second-chat draft');

    await page.reload();
    await expect(chatWindow(page, provider, firstTitle)).toContainText('A follow-up only for the first chat');
    await expect(chatWindow(page, provider, secondTitle).getByRole('textbox', { name: `Message ${provider} in ${secondTitle}`, exact: true })).toHaveValue('An unsent second-chat draft');
  });
}

test('renames, moves, resizes, minimizes and restores a saved chat across refresh', async ({ page }) => {
  await openWorkspace(page);
  let window = await launchAgent(page, 'Claude', 'A chat to organize');
  await window.getByRole('textbox', { name: 'Rename A chat to organize', exact: true }).fill('Launch notes');
  window = chatWindow(page, 'Claude', 'Launch notes');
  await expect(window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true })).toBeVisible();

  const before = (await window.boundingBox())!;
  const move = window.getByRole('button', { name: 'Move Launch notes', exact: true });
  await move.focus(); await move.press('ArrowRight'); await move.press('ArrowDown');
  await expect.poll(async () => (await window.boundingBox())!.x).toBe(before.x + 10);
  await expect.poll(async () => (await window.boundingBox())!.y).toBe(before.y + 10);
  const resize = window.getByRole('button', { name: 'Resize Launch notes', exact: true });
  await resize.focus(); await resize.press('ArrowRight');
  await expect.poll(async () => (await window.boundingBox())!.width).toBe(before.width + 10);
  const moved = (await window.boundingBox())!;
  await expectInsideViewport(page, window);

  await window.getByRole('button', { name: 'Minimize Launch notes', exact: true }).click();
  await expect(window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Restore Launch notes', exact: true })).toBeVisible();
  expect((await window.boundingBox())!.height).toBeLessThanOrEqual(48);
  await savedChats(page).getByRole('button', { name: 'Open saved Claude chat Launch notes', exact: true }).click();
  await expect(window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true })).toBeVisible();

  await window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true }).fill('Keep this draft');
  await window.getByRole('button', { name: 'Close Launch notes', exact: true }).click();
  await expect(window).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Latest agent response', exact: true })).toHaveCount(0);
  const saved = savedChats(page).getByRole('button', { name: 'Open saved Claude chat Launch notes', exact: true });
  await expect(saved).toHaveAttribute('aria-pressed', 'false');
  await saved.click();
  await expect(window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true })).toHaveValue('Keep this draft');
  await page.reload();
  window = chatWindow(page, 'Claude', 'Launch notes');
  await expect(window).toContainText('Claude chat response: A chat to organize');
  await expect(window.getByRole('textbox', { name: 'Message Claude in Launch notes', exact: true })).toHaveValue('Keep this draft');
  const restored = (await window.boundingBox())!;
  expect(restored.x).toBe(moved.x); expect(restored.y).toBe(moved.y); expect(restored.width).toBe(moved.width);
});

test('dragging a lower chat brings it forward and keeps it in front after release', async ({ page }) => {
  await openWorkspace(page);
  const first = await launchAgent(page, 'Claude', 'First stacked conversation');
  const second = await launchAgent(page, 'Claude', 'Second stacked conversation');
  const zIndex = (window: Locator) => window.evaluate(element => Number(getComputedStyle(element).zIndex));
  expect(await zIndex(first)).toBeLessThan(await zIndex(second));
  const handle = (await first.getByRole('button', { name: 'Move First stacked conversation', exact: true }).boundingBox())!;
  const before = (await first.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => zIndex(first)).toBeGreaterThan(await zIndex(second));
  await expect.poll(async () => (await first.boundingBox())!.x).toBe(before.x + 80);
  await expectInsideViewport(page, first);
});

test('concurrent Claude windows route streamed replies and stop only their own request', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  const composer = page.getByRole('region', { name: 'Command composer', exact: true });
  const firstTitle = 'First concurrent Claude question', secondTitle = 'Second concurrent Claude question';
  await composer.getByRole('textbox', { name: 'Your prompt', exact: true }).fill(firstTitle);
  await composer.getByRole('button', { name: 'Send message', exact: true }).click();
  const first = chatWindow(page, 'Claude', firstTitle);
  await expect(first.getByRole('button', { name: 'Stop Claude response', exact: true })).toBeVisible();

  await composer.getByRole('textbox', { name: 'Your prompt', exact: true }).fill(secondTitle);
  await composer.getByRole('button', { name: 'Send message', exact: true }).click();
  const second = chatWindow(page, 'Claude', secondTitle);
  await expect(second.getByRole('button', { name: 'Stop Claude response', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.streamChat('claude', 'Only the first chat receives this live draft.'));
  await expect(first).toContainText('Only the first chat receives this live draft.');
  await expect(second).not.toContainText('Only the first chat receives this live draft.');

  await second.getByRole('button', { name: 'Stop Claude response', exact: true }).click();
  await expect(second).toContainText('Stopped.');
  await expect(second.getByRole('button', { name: 'Send to Claude', exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Stop Claude response', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('claude', 'Only the first chat receives this completed answer.'));
  await expect(first).toContainText('Only the first chat receives this completed answer.');
  await expect(first).not.toContainText('Stopped.');
  await expect(second).not.toContainText('Only the first chat receives this completed answer.');
});

test('ChatGPT menu opens general chat and image studio with a downloadable persistent image window', async ({ page }) => {
  await openWorkspace(page);
  let general = await launchChatGPT(page, 'General chat');
  await general.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true }).fill('Explain the northern lights');
  await general.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  general = chatWindow(page, 'ChatGPT', 'Explain the northern lights');
  await expect(general).toContainText('ChatGPT response: Explain the northern lights');
  await general.getByRole('textbox', { name: 'Rename Explain the northern lights', exact: true }).fill('General notes');
  general = chatWindow(page, 'ChatGPT', 'General notes');

  let studio = await launchChatGPT(page, 'Create image');
  const imagePrompt = 'A moon above the mountain lake';
  await studio.getByRole('textbox', { name: 'Message ChatGPT in New image studio', exact: true }).fill(imagePrompt);
  await studio.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  studio = chatWindow(page, 'ChatGPT', imagePrompt);
  await expect(studio).toContainText('Image created.');
  await expect(general).not.toContainText(imagePrompt);
  const imageWindow = page.getByRole('region', { name: 'Generated image window', exact: true });
  await expect(imageWindow).toBeVisible();
  await expect(imageWindow.getByRole('img', { name: imagePrompt, exact: true })).toHaveJSProperty('naturalWidth', 1);
  await expectInsideViewport(page, imageWindow);
  const downloadLink = imageWindow.getByRole('link', { name: 'Download generated image', exact: true });
  await expect(downloadLink).toHaveAttribute('href', /^data:image\/png;base64,/);
  const downloadPromise = page.waitForEvent('download');
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^aphelion-[\w-]+\.png$/); expect(await download.failure()).toBeNull();

  await imageWindow.getByRole('button', { name: `Close ${imagePrompt}`, exact: true }).click();
  await expect(imageWindow).toHaveCount(0);
  await studio.getByRole('button', { name: 'Open image', exact: true }).click();
  await expect(imageWindow).toBeVisible();
  await page.reload();
  await expect(imageWindow.getByRole('img', { name: imagePrompt, exact: true })).toHaveJSProperty('naturalWidth', 1);
  await expect(imageWindow.getByRole('link', { name: 'Download generated image', exact: true })).toHaveAttribute('href', /^data:image\/png;base64,/);
  await expect(chatWindow(page, 'ChatGPT', 'General notes')).toContainText('ChatGPT response: Explain the northern lights');
});

test('an explicitly selected API connection keeps its ChatGPT window prompt while connecting', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false, chatGPTConnected: false });
  let window = await launchChatGPT(page, 'General chat');
  const field = window.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true });
  await field.fill('Keep this question while connecting');
  await window.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  await expect(field).toHaveValue('Keep this question while connecting');
  await window.getByRole('combobox', { name: 'Chat connection source', exact: true }).selectOption('api');
  await window.getByLabel('OpenAI API key', { exact: true }).fill('sk-e2e-dummy-key');
  await window.getByRole('button', { name: 'Connect API key', exact: true }).click();
  await expect(window.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
  await expect(window.getByRole('button', { name: 'OpenAI connection', exact: true })).toContainText('API key');
  await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(window.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  window = chatWindow(page, 'ChatGPT', 'Keep this question while connecting');
  await expect(window).toContainText('OpenAI response: Keep this question while connecting');
  const persisted = await page.evaluate(() => Object.values(localStorage).join('\n'));
  expect(persisted).not.toContain('sk-e2e-dummy-key');
});

test('disconnected ChatGPT keeps its connection form and own composer usable in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openWorkspace(page, { openaiConfigured: false, chatGPTConnected: false });
  let window = await launchChatGPT(page, 'General chat');
  await expectInsideViewport(page, window);
  const composer = window.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true });
  await expectInsideViewport(page, composer);
  await composer.fill('A question from the landscape window');
  await window.getByRole('combobox', { name: 'Chat connection source', exact: true }).selectOption('api');
  await window.getByLabel('OpenAI API key', { exact: true }).fill('sk-e2e-landscape-key');
  const connect = window.getByRole('button', { name: 'Connect API key', exact: true });
  await connect.scrollIntoViewIfNeeded();
  await expectInsideViewport(page, connect);
  await connect.click();
  await expect(window.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('API key');
  await expect(composer).toHaveValue('A question from the landscape window');
  await expectInsideViewport(page, composer);
  await window.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  window = chatWindow(page, 'ChatGPT', 'A question from the landscape window');
  await expect(window).toContainText('OpenAI response: A question from the landscape window');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`floating windows stay inside ${viewport.width} by ${viewport.height} and keyboard movement clamps`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page);
    const window = await launchAgent(page, 'Claude', 'A movable mobile chat');
    await expectInsideViewport(page, window);
    const move = window.getByRole('button', { name: 'Move A movable mobile chat', exact: true });
    await move.focus();
    await move.press('Shift+ArrowLeft'); await move.press('Shift+ArrowLeft');
    await expect.poll(async () => (await window.boundingBox())!.x).toBe(12);
    await move.press('Shift+ArrowUp'); await move.press('Shift+ArrowUp');
    await expectInsideViewport(page, window);
    for (let index = 0; index < 16; index++) { await move.press('Shift+ArrowRight'); await move.press('Shift+ArrowDown'); }
    await expectInsideViewport(page, window);
    const before = (await window.boundingBox())!;
    await move.press('Shift+ArrowRight'); await move.press('Shift+ArrowDown');
    const clamped = (await window.boundingBox())!;
    expect(clamped.x).toBe(before.x); expect(clamped.y).toBe(before.y);
    await expect(window.getByRole('textbox', { name: 'Message Claude in A movable mobile chat', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Close A movable mobile chat', exact: true })).toBeVisible();
  });
}
