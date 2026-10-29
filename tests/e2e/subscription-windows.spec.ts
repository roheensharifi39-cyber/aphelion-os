import { test, expect, type Locator, type Page } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

test.use({ reducedMotion: 'reduce' });
test.setTimeout(90000);

function chatWindow(page: Page, title: string) {
  return page.getByRole('region', { name: 'ChatGPT chat window', exact: true }).filter({ has: page.getByRole('textbox', { name: `Rename ${title}`, exact: true }) });
}
async function launch(page: Page, image = false) {
  const tools = page.getByRole('button', { name: 'ChatGPT tools', exact: true });
  if (!await tools.isVisible()) await page.getByRole('button', { name: 'Toggle intelligence panel', exact: true }).click();
  await tools.click();
  await page.getByRole('button', { name: image ? 'Create image' : 'General chat', exact: true }).click();
  const window = chatWindow(page, image ? 'New image studio' : 'New ChatGPT chat');
  await expect(window).toBeVisible(); return window;
}
async function rename(page: Page, window: Locator, before: string, after: string) {
  await window.getByRole('textbox', { name: `Rename ${before}`, exact: true }).fill(after);
  return chatWindow(page, after);
}
async function focusSaved(page: Page, title: string) {
  await page.getByLabel('Saved chat windows', { exact: true }).getByRole('button', { name: `Open saved ChatGPT chat ${title}`, exact: true }).click();
}
async function send(window: Locator, title: string, prompt: string) {
  await window.getByRole('textbox', { name: `Message ChatGPT in ${title}`, exact: true }).fill(prompt);
  await window.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
}
async function insideViewport(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox(), viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('general chat defaults to the ChatGPT plan and sends without an API key', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false });
  let window = await launch(page);
  await expect(window.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('ChatGPT plan');
  await expect(window.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
  await send(window, 'New ChatGPT chat', 'Explain how tides work');
  window = chatWindow(page, 'Explain how tides work');
  await expect(window).toContainText('ChatGPT response: Explain how tides work');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([
    expect.objectContaining({ source: 'subscription', messages: [{ role: 'user', content: 'Explain how tides work' }] }),
  ]);
  expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([]);
});

test('two ChatGPT plan windows isolate streamed replies and stop only their own request', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false, deferredOpenAIChat: true });
  let first = await launch(page);
  await send(first, 'New ChatGPT chat', 'First plan question');
  first = chatWindow(page, 'First plan question');
  await expect(first.getByRole('button', { name: 'Stop ChatGPT response', exact: true })).toBeVisible();
  let second = await launch(page);
  await send(second, 'New ChatGPT chat', 'Second plan question');
  second = chatWindow(page, 'Second plan question');
  await expect(second.getByRole('button', { name: 'Stop ChatGPT response', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__aphelionE2E.streamOpenAIChat('First plan question', 'Only the first window receives this draft.');
    (window as any).__aphelionE2E.streamOpenAIChat('Second plan question', 'Only the second window receives this draft.');
  });
  await expect(first).toContainText('Only the first window receives this draft.');
  await expect(first).not.toContainText('Only the second window receives this draft.');
  await expect(second).toContainText('Only the second window receives this draft.');
  await expect(second).not.toContainText('Only the first window receives this draft.');
  await second.getByRole('button', { name: 'Stop ChatGPT response', exact: true }).click();
  await expect(second).toContainText('Stopped');
  await expect(second).toContainText('Only the second window receives this draft.');
  await expect(first.getByRole('button', { name: 'Stop ChatGPT response', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.finishOpenAIChat('First plan question', 'The first plan answer completed.'));
  await expect(first).toContainText('The first plan answer completed.');
  await expect(second).not.toContainText('The first plan answer completed.');
  const requests = await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests());
  expect(requests.map((request: any) => request.source)).toEqual(['subscription', 'subscription']);
  expect(await page.evaluate(() => (window as any).__aphelionE2E.cancelledRequests())).toEqual([requests[1].requestId]);
});

test('ChatGPT sign-in starts from the window and polling restores the saved draft after refresh', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false, chatGPTConnected: false });
  let window = await launch(page);
  const prompt = 'Keep my draft through subscription sign-in';
  await send(window, 'New ChatGPT chat', prompt);
  await expect(window.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true })).toHaveValue(prompt);
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).toEqual([]);
  await window.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
  expect((await page.evaluate(() => (window as any).__aphelionE2E.connectionCalls())).starts).toBe(1);
  await page.reload();
  window = chatWindow(page, 'New ChatGPT chat');
  await expect(window.getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
  await expect(window.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true })).toHaveValue(prompt);
  await page.evaluate(() => (window as any).__aphelionE2E.finishChatGPTLogin('restored@chatgpt.test'));
  await expect(window.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Cancel sign-in', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(window).toContainText('Connected as restored@chatgpt.test');
  await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await send(window, 'New ChatGPT chat', prompt);
  window = chatWindow(page, prompt);
  await expect(window).toContainText(`ChatGPT response: ${prompt}`);
});

test('subscription sign-in can be cancelled and the connected account can be disconnected', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false, chatGPTConnected: false });
  const window = await launch(page);
  await window.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await window.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.finishChatGPTLogin());
  await expect(window.getByRole('button', { name: 'Cancel sign-in', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(window).toContainText('Connected as fixture@chatgpt.test');
  await window.getByRole('button', { name: 'Disconnect ChatGPT', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aphelionE2E.connectionCalls())).toMatchObject({ starts: 2, cancels: 1, disconnects: 1 });
});

test('image studio defaults to Codex without an API key and keeps a downloadable image after refresh', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false });
  let studio = await launch(page, true);
  await expect(studio.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('Codex plan');
  await studio.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(studio.getByRole('combobox', { name: 'Image connection source', exact: true })).toHaveValue('codex');
  await expect(studio.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
  await studio.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  const prompt = 'Moonlight above a quiet lake';
  await send(studio, 'New image studio', prompt); studio = chatWindow(page, prompt);
  await expect(studio).toContainText('Image created.');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([expect.objectContaining({ prompt, source: 'codex' })]);
  const preview = page.getByRole('region', { name: 'Generated image window', exact: true });
  await expect(preview.getByRole('img', { name: prompt, exact: true })).toHaveJSProperty('naturalWidth', 1);
  const downloadPromise = page.waitForEvent('download');
  await preview.getByRole('link', { name: 'Download generated image', exact: true }).click();
  expect(await (await downloadPromise).failure()).toBeNull();
  await preview.getByRole('button', { name: `Close ${prompt}`, exact: true }).click();
  await studio.getByRole('button', { name: 'Open image', exact: true }).click();
  await page.reload();
  await expect(preview.getByRole('img', { name: prompt, exact: true })).toHaveJSProperty('naturalWidth', 1);
  await expect(preview.getByRole('link', { name: 'Download generated image', exact: true })).toHaveAttribute('href', /^data:image\/png;base64,/);
});

test('a signed-out Codex image window keeps its draft and connects Codex instead of using an available API key', async ({ page }) => {
  await openWorkspace(page, { codexConnected: false });
  let studio = await launch(page, true);
  await send(studio, 'New image studio', 'A garden under moonlight');
  await expect(studio.getByRole('textbox', { name: 'Message ChatGPT in New image studio', exact: true })).toHaveValue('A garden under moonlight');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).toEqual([]);
  await studio.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await expect(studio).toContainText('Codex image generation is ready');
  await studio.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click();
  studio = chatWindow(page, 'A garden under moonlight'); await expect(studio).toContainText('Image created.');
  expect((await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).map((request: any) => request.source)).toEqual(['codex']);
});

test('API connection selection belongs to its own window and remains explicit after refresh', async ({ page }) => {
  await openWorkspace(page);
  let first = await launch(page); first = await rename(page, first, 'New ChatGPT chat', 'API conversation');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await first.getByRole('combobox', { name: 'Chat connection source', exact: true }).selectOption('api');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  let second = await launch(page); second = await rename(page, second, 'New ChatGPT chat', 'Plan conversation');
  await expect(second.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('ChatGPT plan');
  await send(second, 'Plan conversation', 'Use my plan for this message');
  await expect(second).toContainText('ChatGPT response: Use my plan for this message');
  await focusSaved(page, 'API conversation');
  await send(first, 'API conversation', 'Use my optional API key here');
  await expect(first).toContainText('OpenAI response: Use my optional API key here');
  expect((await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).map((request: any) => request.source)).toEqual(['subscription', 'api']);
  await page.reload();
  first = chatWindow(page, 'API conversation'); second = chatWindow(page, 'Plan conversation');
  await expect(first.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('API key');
  await expect(second.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText('ChatGPT plan');
  await focusSaved(page, 'API conversation');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(first.getByRole('combobox', { name: 'Chat connection source', exact: true })).toHaveValue('api');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await send(first, 'API conversation', 'Still use this explicit API choice');
  await expect(first).toContainText('OpenAI response: Still use this explicit API choice');
  expect((await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).map((request: any) => request.source)).toEqual(['api']);
});

for (const source of ['subscription', 'api'] as const) {
  test(`a ${source} chat failure never falls back to the other connected source`, async ({ page }) => {
    await openWorkspace(page);
    let window = await launch(page);
    if (source === 'api') {
      await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
      await window.getByRole('combobox', { name: 'Chat connection source', exact: true }).selectOption('api');
      await window.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
    }
    await page.evaluate(source => (window as any).__aphelionE2E.failOpenAISource(source, 'This selected connection has reached its allowance.'), source);
    await send(window, 'New ChatGPT chat', 'Keep the selected billing source'); window = chatWindow(page, 'Keep the selected billing source');
    await expect(window).toContainText('This selected connection has reached its allowance.');
    await expect(window.getByRole('button', { name: 'OpenAI connection', exact: true })).toHaveText(source === 'api' ? 'API key' : 'ChatGPT plan');
    expect((await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests())).map((request: any) => request.source)).toEqual([source]);
  });
}

test('a Codex image failure never falls back to an available API key', async ({ page }) => {
  await openWorkspace(page);
  let studio = await launch(page, true);
  await page.evaluate(() => (window as any).__aphelionE2E.failImageSource('codex', 'Your Codex image allowance has been reached.'));
  await send(studio, 'New image studio', 'A tiny moon'); studio = chatWindow(page, 'A tiny moon');
  await expect(studio).toContainText('Your Codex image allowance has been reached.');
  await expect(page.getByRole('region', { name: 'Generated image window', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__aphelionE2E.imageRequests())).map((request: any) => request.source)).toEqual(['codex']);
});

test('subscription model choices stay with their window and the picker refreshes for the connected account', async ({ page }) => {
  await openWorkspace(page, { openaiConfigured: false });
  let first = await launch(page); first = await rename(page, first, 'New ChatGPT chat', 'Chosen model conversation');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await expect(first).toContainText('Connected as fixture@chatgpt.test');
  await first.getByRole('combobox', { name: 'ChatGPT subscription model', exact: true }).selectOption('gpt-6-luna');
  await first.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await send(first, 'Chosen model conversation', 'Use the selected subscription model');
  await expect(first).toContainText('ChatGPT response: Use the selected subscription model');
  expect((await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests()))[0]).toMatchObject({ source: 'subscription', model: 'gpt-6-luna' });
  let second = await launch(page); second = await rename(page, second, 'New ChatGPT chat', 'Account model conversation');
  await second.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  const picker = second.getByRole('combobox', { name: 'ChatGPT subscription model', exact: true });
  await expect(picker).toHaveValue('');
  await page.evaluate(() => {
    (window as any).__aphelionE2E.setChatGPTModels([{ slug: 'workspace-model', display_name: 'Workspace model', visibility: 'visible' }]);
    (window as any).__aphelionE2E.finishChatGPTLogin('workspace@chatgpt.test');
  });
  await second.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(second).toContainText('Connected as workspace@chatgpt.test');
  await expect(picker.getByRole('option', { name: 'Workspace model', exact: true })).toHaveCount(1);
  await expect(picker.getByRole('option', { name: 'GPT-6 Luna', exact: true })).toHaveCount(0);
  await picker.selectOption('workspace-model');
  await second.getByRole('button', { name: 'OpenAI connection', exact: true }).click();
  await send(second, 'Account model conversation', 'Use the account model catalog');
  await expect(second).toContainText('ChatGPT response: Use the account model catalog');
  expect((await page.evaluate(() => (window as any).__aphelionE2E.openAIRequests()))[1]).toMatchObject({ source: 'subscription', model: 'workspace-model' });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`subscription sign-in source and controls remain usable at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page, { openaiConfigured: false, chatGPTConnected: false });
    const window = await launch(page);
    const source = window.getByRole('combobox', { name: 'Chat connection source', exact: true });
    const signIn = window.getByRole('button', { name: 'Continue with ChatGPT', exact: true });
    await expect(source).toHaveValue('subscription');
    await expect(source).toBeInViewport({ ratio: 1 });
    await expect(signIn).toBeInViewport({ ratio: 1 });
    await page.screenshot({path:`.impeccable/review/subscriptions/sign-in-${viewport.width}.png`});
    await insideViewport(page, source); await insideViewport(page, signIn);
    const composer = window.getByRole('textbox', { name: 'Message ChatGPT in New ChatGPT chat', exact: true });
    await composer.fill('Keep this mobile sign-in draft');
    await signIn.click();
    const cancel = window.getByRole('button', { name: 'Cancel sign-in', exact: true });
    await expect(cancel).toBeVisible();
    await page.screenshot({path:`.impeccable/review/subscriptions/sign-in-pending-${viewport.width}.png`});
    await insideViewport(page, cancel); await insideViewport(page, composer);
    await expect(composer).toHaveValue('Keep this mobile sign-in draft');
    await cancel.click(); await expect(signIn).toBeVisible();
  });
}
