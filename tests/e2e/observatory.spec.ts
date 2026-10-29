import { test, expect } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

test('routes an agent prompt with explicit vault context and saves the result', async ({ page }) => {
  await openWorkspace(page);
  const composer = page.getByRole('region', { name: 'Command composer' });
  await page.getByRole('button', { name: 'Select Codex', exact: true }).click();
  await composer.getByRole('button', { name: 'Attach context', exact: true }).click();
  await composer.getByRole('checkbox', { name: 'Architecture' }).check();
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Explain this architecture');
  await composer.getByRole('button', { name: 'Send message' }).click();
  const response = page.getByRole('region', { name: 'Latest agent response' });
  await expect(response).toContainText('Explain this architecture');
  await expect(page.getByRole('button', { name: 'Inspect memory Conversation Explain this architecture' })).toHaveCount(1);
});

test('switches vaults and projects through the existing local bridge', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Switch Obsidian vault' }).click();
  await expect(page.getByRole('button', { name: 'Switch Obsidian vault' })).toContainText('OtherFixtureVault');
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('button', { name: 'Select project folder' }).click();
  await dialog.getByRole('button', { name: 'Close module' }).click();
  await expect(page.getByRole('button', { name: 'Switch project', exact: true })).toContainText('Selected project');
});

test('keeps conversations, drafts and remembered notes in their own vault', async ({ page }) => {
  await openWorkspace(page);
  const composer = page.getByRole('region', { name: 'Command composer' });
  const prompt = composer.getByRole('textbox', { name: 'Your prompt' });
  const field = page.locator('.vault-field');
  const originalSeed = await field.getAttribute('data-vault-seed');
  await prompt.fill('Remember the first vault idea');
  await composer.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText('Claude chat response: Remember the first vault idea');
  await expect(page.getByRole('button', { name: 'Inspect memory Conversation Remember the first vault idea' })).toHaveCount(1);
  await prompt.fill('First vault draft');

  await page.getByRole('button', { name: 'Switch Obsidian vault' }).click();
  await expect(prompt).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toHaveCount(0);
  await expect(field).not.toHaveAttribute('data-vault-seed', originalSeed!);
  await expect(page.getByRole('button', { name: /^Inspect memory/ })).toHaveCount(0);
  await prompt.fill('A different vault idea');
  await composer.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText('Claude chat response: A different vault idea');
  await prompt.fill('Second vault draft');

  await page.getByRole('button', { name: 'Switch Obsidian vault' }).click();
  await expect(prompt).toHaveValue('First vault draft');
  await expect(field).toHaveAttribute('data-vault-seed', originalSeed!);
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText('Claude chat response: Remember the first vault idea');
  await expect(page.getByRole('region', { name: 'Latest agent response' })).not.toContainText('A different vault idea');
  await page.reload();
  await expect(prompt).toHaveValue('First vault draft');
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText('Remember the first vault idea');
});

test('runs project tools and inspects actual note context from the overview', async ({ page }) => {
  await openWorkspace(page);
  const dock = page.getByRole('region', { name: 'Workspace tools', exact: true });
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await dock.getByRole('button', { name: 'Git diff', exact: true }).click();
  const terminal = page.getByRole('dialog', { name: 'Terminal', exact: true });
  await expect(terminal.getByLabel('Terminal command')).toHaveValue('diff');
  await terminal.getByRole('button', { name: 'Run command' }).click();
  await expect(terminal.getByLabel('Terminal output')).toContainText('+export const answer = 42;');
  await terminal.getByRole('button', { name: 'Close module' }).click();

  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await dock.getByRole('button', { name: /^Notes & context/ }).click();
  await dock.getByRole('searchbox', { name: 'Search vault notes' }).fill('Architecture');
  await dock.getByRole('button', { name: 'Attach Architecture as context' }).click();
  await dock.getByRole('button', { name: 'Architecture Architecture.md', exact: true }).click();
  const memory = page.getByRole('region', { name: 'Selected vault memory' });
  await expect(memory).toContainText('The core uses local event streams.');
  await expect(memory.getByRole('button', { name: 'Remove from context' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Command composer' })).toBeVisible();
  await memory.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue(/local event streams/);
});

test('preserves an unsent prompt when connecting a signed-out agent', async ({ page }) => {
  await openWorkspace(page, { connected: { claude: false, codex: true } });
  const composer = page.getByRole('region', { name: 'Command composer' });
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Keep this idea');
  await composer.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your orbit.' })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Your prompt' })).toHaveValue('Keep this idea');
});

test('reduced motion keeps plain headings and disables additive cursor effects', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page);
  await expect(page.locator('.cursor-field')).toBeHidden();
  const title = page.getByRole('heading', { name: 'Your living vault' });
  await expect(title).toHaveText('Your living vault');
  await expect(title.locator('span')).toHaveCount(0);
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).cursor)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.cursor-field')).toBeVisible();
});

test('mobile layout stays within the viewport and opens the vault editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Explore vault', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
});

test('a two-agent mission keeps its stop control when provider selection is attempted', async ({ page }) => {
  await openWorkspace(page, { deferredMission: true });
  const composer = page.getByRole('region', { name: 'Command composer' });
  await composer.getByLabel('Mission mode', { exact: true }).selectOption('mission');
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Build the selected project');
  await composer.getByRole('button', { name: 'Launch mission' }).click();
  await expect(page.getByRole('button', { name: 'Select Claude', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Select Codex', exact: true })).toBeDisabled();
  await composer.getByRole('button', { name: 'Stop mission' }).click();
  await expect(composer.getByRole('button', { name: 'Launch mission' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Latest agent response' }).first()).toContainText('Mission stopped');
});

test('landscape keeps the composer and scene controls inside the visible screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openWorkspace(page);
  const composer = await page.getByRole('region', { name: 'Command composer' }).boundingBox();
  expect(composer).not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Pause vault motion' })).toBeInViewport();
});

test.describe('touch devices', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('disables additive cursor overlays on coarse pointers', async ({ page }) => {
    await openWorkspace(page);
    await expect(page.locator('.cursor-field')).toBeHidden();
    await page.getByRole('button', { name: 'Toggle intelligence panel' }).click();
    await expect(page.getByRole('button', { name: 'Select Codex' })).toBeVisible();
  });
});
