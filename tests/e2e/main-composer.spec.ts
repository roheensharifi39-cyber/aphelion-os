import { test, expect, type Page } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

test.use({ reducedMotion: 'reduce' });
test.setTimeout(90000);
const composer = (page: Page) => page.getByRole('region', { name: 'Command composer', exact: true });
const prompt = (page: Page) => composer(page).getByRole('textbox', { name: 'Your prompt', exact: true });
const chatWindow = (page: Page, title: string) => page.getByRole('region', { name: 'ChatGPT chat window', exact: true }).filter({ has: page.getByRole('textbox', { name: `Rename ${title}`, exact: true }) });
async function selectGPT(page: Page, mode: 'chat' | 'image' = 'chat') {
  await composer(page).getByLabel('Agent', { exact: true }).selectOption('chatgpt');
  await composer(page).getByLabel('ChatGPT mode', { exact: true }).selectOption(mode);
}

test('main ChatGPT chat submits once with vault context and opens its own saved window', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false });
  await selectGPT(page);
  await composer(page).getByRole('button', { name: 'Attach context', exact: true }).click();
  await composer(page).getByRole('checkbox', { name: 'Architecture' }).check();
  await composer(page).getByRole('button', { name: 'Close context', exact: true }).click();
  await prompt(page).fill('Explain my architecture');
  await composer(page).getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  const chat = chatWindow(page, 'Explain my architecture');
  await expect(chat).toContainText('ChatGPT response: Explain my architecture');
  await expect(chat.getByLabel('ChatGPT chat mode')).toHaveValue('chat');
  await expect(prompt(page)).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([
    expect.objectContaining({ source: 'subscription', contextPaths: ['Architecture.md'], messages: [{ role: 'user', content: 'Explain my architecture' }] }),
  ]);
  expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([]);
  await chat.getByRole('button', { name: 'Close Explain my architecture', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open saved ChatGPT chat Explain my architecture', exact: true }).click();
  await expect(chatWindow(page, 'Explain my architecture')).toContainText('ChatGPT response: Explain my architecture');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([]);
});

test('main image mode uses Codex and opens a downloadable image alongside its studio', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false });
  await selectGPT(page, 'image');
  await expect(composer(page).getByRole('button', { name: 'Attach context', exact: true })).toHaveCount(0);
  await prompt(page).fill('A silver moon above still water');
  await composer(page).getByRole('button', { name: 'Generate image', exact: true }).click();
  const chat = chatWindow(page, 'A silver moon above still water');
  await expect(chat.getByLabel('ChatGPT chat mode')).toHaveValue('image');
  await expect(chat).toContainText('Image created.');
  const image = page.getByRole('region', { name: 'Generated image window', exact: true });
  await expect(image.getByRole('img', { name: 'A silver moon above still water', exact: true })).toBeVisible();
  await expect(image.getByRole('link', { name: 'Download generated image', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([
    expect.objectContaining({ source: 'codex', prompt: 'A silver moon above still water' }),
  ]);
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([]);
});

test('provider and mode changes retain independent drafts through reload and vault switching', async ({ page }) => {
  await openWorkspace(page);
  await prompt(page).fill('Claude draft');
  await selectGPT(page);
  await prompt(page).fill('ChatGPT draft');
  await composer(page).getByLabel('ChatGPT mode').selectOption('image');
  await expect(prompt(page)).toHaveValue('');
  await prompt(page).fill('Image draft');
  await composer(page).getByLabel('Agent', { exact: true }).selectOption('codex');
  await expect(prompt(page)).toHaveValue('');
  await prompt(page).fill('Codex draft');
  await composer(page).getByLabel('Agent', { exact: true }).selectOption('claude');
  await expect(prompt(page)).toHaveValue('Claude draft');
  await selectGPT(page);
  await expect(prompt(page)).toHaveValue('ChatGPT draft');
  await page.reload();
  await selectGPT(page, 'image');
  await expect(prompt(page)).toHaveValue('Image draft');
  await page.getByRole('button', { name: 'Switch Obsidian vault', exact: true }).click();
  await expect(prompt(page)).toHaveValue('');
  await prompt(page).fill('Other vault image draft');
  await page.getByRole('button', { name: 'Switch Obsidian vault', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Image draft');
  await composer(page).getByLabel('ChatGPT mode').selectOption('chat');
  await expect(prompt(page)).toHaveValue('ChatGPT draft');
});

test('Enter starts separate concurrent chats without duplicating or crossing their responses', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false, deferredOpenAIChat: true });
  await selectGPT(page);
  await prompt(page).fill('First main chat');
  await prompt(page).press('Enter');
  await expect(chatWindow(page, 'First main chat').getByRole('button', { name: 'Stop ChatGPT response', exact: true })).toBeVisible();
  await prompt(page).press('Enter');
  await prompt(page).fill('Second main chat');
  await prompt(page).press('Enter');
  await expect(chatWindow(page, 'Second main chat').getByRole('button', { name: 'Stop ChatGPT response', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toHaveLength(2);
  await page.evaluate(() => {
    (window as any).__aphelionE2E.finishOpenAIChat('First main chat', 'First answer only');
    (window as any).__aphelionE2E.finishOpenAIChat('Second main chat', 'Second answer only');
  });
  await expect(chatWindow(page, 'First main chat')).toContainText('First answer only');
  await expect(chatWindow(page, 'First main chat')).not.toContainText('Second answer only');
  await expect(chatWindow(page, 'Second main chat')).toContainText('Second answer only');
});

for (const mode of ['chat', 'image'] as const) {
  test(`missing ${mode} connection keeps the prompt in its window without using an API key`, async ({ page }) => {
    await openWorkspace(page, { chatGPTConnected: false, codexConnected: false });
    await selectGPT(page, mode);
    await prompt(page).fill(`Keep my ${mode} prompt`);
    await prompt(page).press('Enter');
    const chat = chatWindow(page, `Keep my ${mode} prompt`);
    await expect(chat.getByRole('textbox', { name: `Message ChatGPT in Keep my ${mode} prompt`, exact: true })).toHaveValue(`Keep my ${mode} prompt`);
    await expect(chat.getByRole('button', { name: mode === 'chat' ? 'Continue with ChatGPT' : 'Check connections', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([]);
    expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([]);
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 740, height: 390 }]) {
  test(`ChatGPT modes and send controls remain usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page, { openaiConfigured: false });
    await selectGPT(page, 'image');
    await prompt(page).fill('Responsive image');
    for (const control of [composer(page).getByLabel('Agent', { exact: true }), composer(page).getByLabel('ChatGPT mode'), composer(page).getByRole('button', { name: 'Generate image', exact: true })]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await composer(page).getByRole('button', { name: 'Generate image', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Generated image window', exact: true })).toBeVisible();
    await page.screenshot({ path: `.impeccable/review/main-composer/${viewport.width}-image.png` });
  });
}
