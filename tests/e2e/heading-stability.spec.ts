import { test, expect } from '@playwright/test';
import { openWorkspace } from './bridge-fixture';

test('keeps a settled response heading visible while the body streams and telemetry updates', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  const composer = page.getByRole('region', { name: 'Command composer' });
  await composer.getByRole('textbox', { name: 'Your prompt' }).fill('Explain the scale curve');
  await composer.getByRole('button', { name: 'Send message' }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.streamChat('claude', '## Desired Scale Curve\n\nWeightToScale should be:'));
  const heading = page.getByRole('heading', { name: 'Desired Scale Curve', exact: true });
  await expect(heading).toBeVisible();
  const opacity = () => heading.evaluate(element => Math.min(...Array.from(element.querySelectorAll('span')).map(span => Number(getComputedStyle(span).opacity)), 1));
  await expect.poll(opacity).toBeGreaterThan(.99);
  await heading.evaluate(element => { (window as any).__settledHeading = element; });

  for (const chunk of ['\n\nKeep the minimum readable.', '\n\nGrow smoothly toward the desired scale.']) {
    await page.evaluate(text => {
      (window as any).__aphelionE2E.updateTelemetry(49);
      (window as any).__aphelionE2E.streamChat('claude', text);
    }, chunk);
    await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText(chunk.trim());
    expect(await heading.evaluate(element => element === (window as any).__settledHeading)).toBe(true);
    expect(await opacity()).toBeGreaterThan(.99);
  }
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('claude', '## Desired Scale Curve\n\nWeightToScale should be:\n\nFinal explanation.'));
  await expect(page.getByRole('region', { name: 'Latest agent response' })).toContainText('Final explanation.');
  expect(await heading.evaluate(element => element === (window as any).__settledHeading)).toBe(true);
  expect(await opacity()).toBeGreaterThan(.99);
});
