import { test, expect } from '@playwright/test';
import { moduleDialog, openWorkspace, prompt, vault } from './bridge-fixture';

test('protects saved model and reasoning choices until initial status loads', async ({ page }) => {
  await openWorkspace(page, { deferredStatus: true, models: { claude: 'sonnet', codex: 'gpt-6-astra' }, reasoning: { claude: 'max', codex: 'xhigh' } });
  await expect(page.getByLabel('Claude model', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Codex reasoning', { exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__aphelionE2E.finishStatus());
  await expect(page.getByLabel('Claude model', { exact: true })).toHaveValue('sonnet');
  await expect(page.getByLabel('Claude reasoning', { exact: true })).toHaveValue('max');
  await expect(page.getByLabel('Codex model', { exact: true })).toHaveValue('gpt-6-astra');
  await expect(page.getByLabel('Codex reasoning', { exact: true })).toHaveValue('xhigh');
});

test('keeps each home Run button fully above its card footer', async ({ page }) => {
  await page.setViewportSize({ width: 1250, height: 1000 });
  await openWorkspace(page);
  const buttons = await page.locator('.cockpit-agents .agent-card').evaluateAll(cards => cards.map(card => {
    const run = card.querySelector('.agent-prompt-form .mc-button')!.getBoundingClientRect();
    const footer = card.querySelector('.agent-card-footer')!.getBoundingClientRect();
    return { label: card.getAttribute('aria-label'), runBottom: run.bottom, footerTop: footer.top };
  }));
  for (const button of buttons) expect(button.runBottom, `${button.label} Run must not overlap the footer`).toBeLessThanOrEqual(button.footerTop);
});

test('runs independent home prompts with saved models and reasoning and animates their own workers', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  await page.getByLabel('Claude model', { exact: true }).selectOption('sonnet');
  await page.getByLabel('Claude reasoning', { exact: true }).selectOption('max');
  await page.getByLabel('Codex model', { exact: true }).selectOption('gpt-6-astra');
  await page.getByLabel('Codex reasoning', { exact: true }).selectOption('xhigh');
  await page.getByLabel('Claude prompt', { exact: true }).fill('Reason about my architecture');
  await expect(prompt(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Run Claude prompt', exact: true }).click();
  await expect(page.locator('.core-worker[data-agent="claude"]')).toHaveAttribute('data-state', 'working');
  await expect(page.locator('.core-worker[data-agent="codex"]')).toHaveAttribute('data-state', 'idle');
  await page.getByLabel('Codex prompt', { exact: true }).fill('Explain a safe implementation');
  await page.getByRole('button', { name: 'Run Codex prompt', exact: true }).click();
  await expect(page.locator('.core-worker[data-agent="codex"]')).toHaveAttribute('data-state', 'working');
  await page.evaluate(() => { (window as any).__aphelionE2E.streamChat('claude', 'Claude live answer'); (window as any).__aphelionE2E.finishChat('codex', 'Codex completed answer'); });
  await expect(page.getByRole('region', { name: 'Claude agent status' })).toContainText('Claude live answer');
  await expect(page.getByRole('region', { name: 'Codex agent status' })).toContainText('Codex completed answer');
  await expect(page.locator('.core-worker[data-agent="codex"]')).toHaveAttribute('data-state', 'idle');
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('claude', 'Claude complete'));
  await page.reload();
  await expect(page.getByLabel('Claude model', { exact: true })).toHaveValue('sonnet');
  await expect(page.getByLabel('Claude reasoning', { exact: true })).toHaveValue('max');
  await expect(page.getByLabel('Codex reasoning', { exact: true })).toHaveValue('xhigh');
});

test('attaches real graph notes and resets reasoning when the chosen model does not support it', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Attach memory Project Memory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attach memory Project Memory', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.agent-channel-meta').first()).toContainText('1 VAULT CONTEXT');
  await page.getByLabel('Claude model', { exact: true }).selectOption('sonnet');
  await page.getByLabel('Claude reasoning', { exact: true }).selectOption('max');
  await page.getByLabel('Claude model', { exact: true }).selectOption('haiku');
  await expect(page.getByLabel('Claude reasoning', { exact: true })).toHaveValue('auto');
  await expect(page.getByLabel('Claude reasoning', { exact: true }).locator('option')).toHaveCount(1);
});

test('renders live telemetry and moves packets only after runtime activity', async ({ page }) => {
  await openWorkspace(page);
  const core = page.getByRole('region', { name: 'Live system core', exact: true });
  await expect(core.locator('svg.core-scene')).toBeVisible();
  await expect(page.locator('.resources-panel')).toContainText('37%');
  await expect(page.locator('.resources-panel')).toContainText('60%');
  await expect(page.locator('.topology-values')).toContainText('2 CLIENTS');
  await expect(page.locator('.process-list')).toContainText('Obsidian');
  await expect(core.locator('.data-packet')).toHaveCount(0);
  await page.evaluate(() => (window as any).__aphelionE2E.activity('claude', 'Read selected project context'));
  await expect(core.locator('.data-packet.claude')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Live activity' })).toContainText('Read selected project context');
  await page.evaluate(() => (window as any).__aphelionE2E.updateTelemetry(49));
  await expect(page.locator('.resources-panel')).toContainText('49%');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.statusbar')).not.toContainText('DEMO');
});

test('opens every tool and the command palette without key setup fields', async ({ page }) => {
  await openWorkspace(page);
  for (const name of ['Workbench', 'Vault', 'Workflows', 'Voice studio', 'Settings', 'Home']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('main')).toBeVisible();
  }
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Find a command', exact: true }).fill('terminal');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Terminal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close module', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('.settings-page').getByLabel('Claude model', { exact: true })).toBeVisible();
  await expect(page.getByLabel('GitHub repository', { exact: true })).toBeVisible();
});

test('keeps agent drafts and conversations separate and flushes reloads during the debounce', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await prompt(page).fill('Plan the launch');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(prompt(page)).toHaveValue('');
  await prompt(page).fill('Write navigation');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Plan the launch');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Claude chat response: Plan the launch');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Write navigation');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Codex chat response: Write navigation');
  await expect(page.locator('article.message.assistant')).not.toContainText('Plan the launch');
  await page.reload();
  await expect(page.locator('article.message.assistant')).toContainText('Claude chat response: Plan the launch');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Codex chat response: Write navigation');
});

test('routes overlapping agent streams to their own sessions across navigation', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await prompt(page).fill('Plan orbit');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await prompt(page).fill('Build orbit');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.evaluate(() => { (window as any).__aphelionE2E.streamChat('codex', 'Codex isolated partial'); (window as any).__aphelionE2E.streamChat('claude', 'Claude isolated partial'); });
  await expect(page.locator('article.message.assistant')).toContainText('Codex isolated partial');
  await expect(page.locator('article.message.assistant')).not.toContainText('Claude isolated partial');
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('claude', 'Claude completed while hidden'));
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Claude completed while hidden');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.finishChat('codex', 'Codex completed independently'));
  await expect(page.locator('article.message.assistant')).toContainText('Codex completed independently');
});

test('preserves partial agent text on a live connection failure', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await prompt(page).fill('Keep my partial reply');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.streamChat('claude', 'Useful partial analysis'));
  await expect(page.locator('article.message.assistant')).toContainText('Useful partial analysis');
  await page.evaluate(() => (window as any).__aphelionE2E.failChat('claude', 'Connection lost'));
  await expect(page.locator('article.message.assistant')).toContainText('Useful partial analysis');
  await expect(page.locator('article.message.assistant')).toContainText('Connection lost');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
});

test('keeps cancellation pending until the request settles and retains new typing', async ({ page }) => {
  await openWorkspace(page, { deferredChat: true });
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await prompt(page).fill('First request');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.evaluate(() => (window as any).__aphelionE2E.streamChat('claude', 'Partial before stop'));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await prompt(page).fill('Replacement prompt');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).not.toBeVisible({ timeout: 150 });
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(prompt(page)).toHaveValue('Replacement prompt');
  await expect(page.locator('article.message.assistant')).toContainText('Partial before stop');
  await expect(page.locator('article.message.assistant')).toContainText('Stopped');
});

test('preserves a signed-out prompt and enables subscription login in the browser client', async ({ page }) => {
  await openWorkspace(page, { connected: { claude: false, codex: true } });
  await page.getByRole('combobox', { name: 'Mission mode', exact: true }).selectOption('chat');
  await prompt(page).fill('Preserve this subscription prompt');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to Claude', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in to Claude', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage Claude sign-in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Preserve this subscription prompt');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  await page.getByRole('button', { name: 'Open Claude conversation', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Claude chat response: Preserve this subscription prompt');
});

test('maps mission phases and both streams, passes selected context, and exposes its receipt', async ({ page }) => {
  await openWorkspace(page, { deferredMission: true });
  await vault(page).getByRole('button', { name: 'Context', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Use Architecture as mission context', exact: true }).check();
  await prompt(page).fill('Build launch controls');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  const core = page.getByRole('region', { name: 'Live system core' });
  const claude = page.getByRole('region', { name: 'Claude agent status' });
  const codex = page.getByRole('region', { name: 'Codex agent status' });
  await expect(core).toContainText('MISSION / PLANNING');
  await expect(codex.locator('.agent-card-state')).toHaveText('WAITING');
  await expect(claude).toContainText('Planner read the selected context.');
  await page.evaluate(() => { (window as any).__aphelionE2E.missionPhase('building', 'codex'); (window as any).__aphelionE2E.streamMission('codex', 'Builder editing src/index.ts.'); });
  await expect(core).toContainText('MISSION / BUILDING');
  await expect(codex).toContainText('Builder editing src/index.ts.');
  await expect(claude).not.toContainText('Builder editing src/index.ts.');
  await page.evaluate(() => { (window as any).__aphelionE2E.missionPhase('saving', 'vault'); (window as any).__aphelionE2E.finishMission(); });
  await expect(page.getByRole('button', { name: 'Launch mission', exact: true })).toBeVisible();
  await vault(page).getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select note Mission receipt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Claude conversation', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Context: Architecture.md');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Codex wrote src/index.ts for Build launch controls.');
  await expect(page.locator('article.message.assistant')).toContainText('Mission receipt saved: Mission receipt.md');
});

test('retains both mission partials if the build fails', async ({ page }) => {
  await openWorkspace(page, { deferredMission: true });
  await prompt(page).fill('A mission with a failing worker');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop mission', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__aphelionE2E.streamMission('claude', ' Retained plan details.'); (window as any).__aphelionE2E.missionPhase('building', 'codex'); (window as any).__aphelionE2E.streamMission('codex', 'Retained build details.'); (window as any).__aphelionE2E.failMission('Worker disconnected'); });
  await page.getByRole('button', { name: 'Open Codex conversation', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Retained build details.');
  await expect(page.locator('article.message.assistant')).toContainText('Worker disconnected');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(page.locator('article.message.assistant')).toContainText('Retained plan details.');
});

test('blocks workflow restart until cancelled mission work settles', async ({ page }) => {
  await openWorkspace(page, { deferredMission: true });
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Stop this workflow safely');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop mission', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Stop workflow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).not.toBeVisible({ timeout: 150 });
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Workflow task', exact: true })).toHaveValue('Stop this workflow safely');
});

test('preserves missing-project mission input and connects create/select project controls', async ({ page }) => {
  await openWorkspace(page, { project: null });
  await prompt(page).fill('Build after connecting my project');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await expect(projects).toBeVisible();
  await projects.getByRole('textbox', { name: 'Project name', exact: true }).fill('New launchpad');
  await projects.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(projects.locator('.connected-project')).toContainText('New launchpad');
  await projects.getByRole('button', { name: 'Close module', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Build after connecting my project');
  await expect(page.getByRole('group', { name: 'Local engine modules' }).getByRole('button', { name: 'Projects', exact: true })).toContainText('New launchpad');
  await moduleDialog(page, 'Projects');
  await projects.getByRole('button', { name: 'Select project folder', exact: true }).click();
  await expect(projects.locator('.connected-project')).toContainText('Selected project');
  await expect(projects.locator('.connected-project')).toContainText('feature/selected');
  await expect(projects.locator('.connected-project')).toContainText('Uncommitted changes');
});

test('browses real component folders and renders the selected source file', async ({ page }) => {
  await openWorkspace(page);
  const files = await moduleDialog(page, 'Files');
  await files.getByRole('button', { name: 'Open directory src', exact: true }).click();
  await files.getByRole('button', { name: 'Open file index.ts', exact: true }).click();
  await expect(files.getByLabel('File content', { exact: true })).toHaveText('export const answer = 42;\n');
  await files.getByRole('button', { name: 'Up', exact: true }).click();
  await files.getByRole('button', { name: 'Open file README.md', exact: true }).click();
  await expect(files.getByLabel('File content', { exact: true })).toContainText('A working local project.');
});

test('shows curated terminal results and automation stdout without duplicating stream output', async ({ page }) => {
  await openWorkspace(page);
  const terminal = await moduleDialog(page, 'Terminal');
  for (const [command, output] of [
    ['status', 'On branch main\nnothing to commit, working tree clean'],
    ['files', 'README.md\nsrc/index.ts'],
    ['diff', 'diff --git a/src/index.ts b/src/index.ts\n+export const answer = 42;'],
    ['test', '2 tests passed'], ['build', 'Build finished: dist/index.js'],
  ]) {
    await terminal.getByRole('combobox', { name: 'Terminal command', exact: true }).selectOption(command);
    await terminal.getByRole('button', { name: 'Run command', exact: true }).click();
    await expect(terminal.getByLabel('Terminal output', { exact: true })).toHaveText(output);
    await expect(terminal.locator('.command-output>div')).toContainText('EXIT 0');
  }
  await terminal.getByRole('button', { name: 'Close module', exact: true }).click();
  const automations = await moduleDialog(page, 'Automations');
  await automations.getByRole('button', { name: 'Run Verify project', exact: true }).click();
  await expect(automations.getByLabel('Terminal output', { exact: true })).toHaveText('Automated verification: 2 checks passed');
  await automations.getByRole('button', { name: 'Run Index vault', exact: true }).click();
  await expect(automations.getByLabel('Terminal output', { exact: true })).toHaveText('Indexed 2 Markdown notes');
});

test('connects graph selection, note editing, mission context, and native Obsidian opening', async ({ page }) => {
  await openWorkspace(page, { obsidianRunning: false });
  await expect(vault(page).locator('.graph-note-links>line')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select note Architecture', exact: true }).click();
  await expect(vault(page).locator('.node-preview-heading')).toContainText('Architecture');
  await vault(page).getByRole('button', { name: 'Open note in Obsidian', exact: true }).click();
  await expect(vault(page).locator('.obsidian-app-link')).toContainText('OBSIDIAN APP OPEN');
  expect(await page.evaluate(() => (window as any).__aphelionE2E.openedNativeNotes())).toEqual(['Architecture.md']);
  await vault(page).getByRole('button', { name: 'Open note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Architecture\n\nThe core uses local event streams.\n\n#design');
  await vault(page).getByRole('button', { name: 'Context', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Use Architecture as mission context', exact: true }).check();
  await expect(page.getByRole('combobox', { name: 'Attach a note', exact: true })).toContainText('1 context files selected');
});

test('creates, edits, previews and reloads a Markdown note through the real editor', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note name', exact: true }).fill('Launch checklist');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('# Launch checklist\n\n## Ready\n\n- [x] Keep the context.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.note-preview').getByRole('heading', { name: 'Ready', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open note Launch checklist', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Launch checklist\n\n## Ready\n\n- [x] Keep the context.');
});

test('retains an unsaved draft across routes and refuses changing its vault folder', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('# Unsaved launch notes');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Choose vault folder', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Save your note draft before switching vault folders.');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Unsaved launch notes');
});

test('does not replace new typing when an older note read completes late', async ({ page }) => {
  await openWorkspace(page, { deferredRead: 'Architecture.md' });
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('Keep the launch context.');
  await page.getByRole('button', { name: 'Open note Architecture', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('# Keep this newer draft');
  await page.evaluate(() => (window as any).__aphelionE2E.finishRead());
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Keep this newer draft');
  await expect(page.locator('.note-toolbar strong')).toHaveText('Project Memory');
});

test('keeps newer edits and file identity while an earlier save is pending', async ({ page }) => {
  await openWorkspace(page, { deferredSave: true });
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('# Saved draft');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('# Newer unsaved draft');
  await page.getByRole('button', { name: 'Open note Architecture', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Finish the current note save before opening another.');
  await page.evaluate(() => (window as any).__aphelionE2E.finishWrite());
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Newer unsaved draft');
  await expect(page.locator('.note-toolbar strong')).toHaveText('Project Memory');
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled();
});

test('keeps note creation stable until its pending write completes', async ({ page }) => {
  await openWorkspace(page, { deferredCreate: true });
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note name', exact: true }).fill('Pending receipt');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Create a note', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.finishWrite());
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue('# Pending receipt\n\n');
  await expect(page.getByRole('dialog', { name: 'Create a note', exact: true })).not.toBeVisible();
});

test('waits for stored preferences before mounting settings fields', async ({ page }) => {
  await openWorkspace(page, { deferredStatus: true, models: { claude: 'claude-selected', codex: 'codex-selected' }, repo: 'https://github.com/example/selected' }, '#settings');
  await expect(page.locator('.settings-page').getByLabel('Claude model', { exact: true })).not.toBeVisible();
  await page.evaluate(() => (window as any).__aphelionE2E.finishStatus());
  await expect(page.locator('.settings-page').getByLabel('Claude model', { exact: true })).toHaveValue('claude-selected');
  await expect(page.locator('.settings-page').getByLabel('Codex model', { exact: true })).toHaveValue('codex-selected');
  await expect(page.getByLabel('GitHub repository', { exact: true })).toHaveValue('https://github.com/example/selected');
});

test('fits mobile navigation and opens a usable note editor without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open Vault', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('respects reduced motion while retaining telemetry, activity, and functional controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page);
  await page.evaluate(() => (window as any).__aphelionE2E.activity('codex', 'Received build channel event'));
  await expect(page.getByRole('region', { name: 'Live activity' })).toContainText('Received build channel event');
  await expect(page.locator('.core-live-packets')).toHaveCount(0);
  expect(await page.locator('.core-reactor').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  const projects = await moduleDialog(page, 'Projects');
  await expect(projects.locator('.connected-project')).toContainText('Launchpad');
});
