import { test, expect } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

test.use({ reducedMotion: 'reduce' });

test('context picker renders within its bounds and submitted context reaches the active membrane agent', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  const composer = page.getByRole('region', { name: 'Command composer' });
  await composer.getByRole('button', { name: 'Attach context', exact: true }).click();
  const list = page.locator('.overview-context-list');
  await expect(list.getByRole('checkbox', { name: 'Architecture Architecture.md', exact: true })).toBeVisible();
  expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await composer.getByRole('checkbox', { name: 'Architecture' }).check();
  await composer.getByRole('button', { name: 'Close context' }).click();
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Review the architecture');
  await composer.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize Review the architecture', exact: true }).click();
  const anchor = page.getByRole('button', { name: 'Inspect Claude activity', exact: true });
  await expect(anchor).toContainText('Working');
  await anchor.click();
  const detail = page.getByRole('region', { name: 'Claude activity', exact: true });
  await expect(detail).toContainText('Architecture.md');
  await expect(page.locator('.agent-connections path')).toHaveCount(1);
  await detail.getByRole('button', { name: 'Close agent activity' }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('claude', 'Review complete'));
  await expect(anchor).toContainText('Response ready');
  await anchor.click();
  await expect(detail.getByRole('button', { name: 'Open saved response' })).toBeVisible();
});

test('mission anchors distinguish planning, queued work, building and verification', async ({ page }) => {
  await openWorkspace(page, { deferredMission: true });
  const composer = page.getByRole('region', { name: 'Command composer' });
  await composer.getByLabel('Mission mode', { exact: true }).selectOption('mission');
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Build the project');
  await composer.getByRole('button', { name: 'Launch mission' }).click();
  const claude = page.getByRole('button', { name: 'Inspect Claude activity', exact: true });
  const codex = page.getByRole('button', { name: 'Inspect Codex activity', exact: true });
  await expect(claude).toContainText('Planning'); await expect(codex).toContainText('Queued for plan');
  await page.evaluate(() => (window as any).__aphelionE2E.missionPhase('building', 'codex'));
  await expect(claude).toContainText('Plan ready'); await expect(codex).toContainText('Building');
  await page.evaluate(() => (window as any).__aphelionE2E.missionPhase('verifying', 'codex'));
  await expect(codex).toContainText('Project verification');
  await composer.getByRole('button', { name: 'Stop mission' }).click();
  await expect(claude).toContainText('Request interrupted');
});

test('mobile Knowledge uses the available height and leaves the particle canvas present', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, { connected: { claude: false, codex: true } });
  await expect(page.getByRole('button', { name: 'Inspect Claude activity' })).toContainText('Sign-in required');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Command composer' })).toBeHidden();
  await expect(page.locator('.vault-field canvas')).toBeVisible();
  const box = await page.locator('.vault-module').boundingBox();
  expect(box!.height).toBeGreaterThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
