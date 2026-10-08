import { describe, expect, it } from 'vitest';
import { totalmem } from 'node:os';
import { createTelemetry } from '../electron/telemetry.mjs';

function dependencies(overrides = {}) {
  return {
    getProcesses: () => [{ pid: process.pid, name: 'test runtime', role: 'desktop' }],
    getActiveJobs: () => 2,
    getProject: async () => ({ path: 'chosen', name: 'project', branch: null, dirty: false }),
    getObsidian: async () => ({ installed: true, running: false, vaultPath: 'vault', watching: true, indexedAt: 123, noteCount: 4, detail: 'Watching vault' }),
    getNetwork: () => ({ online: true, clients: 3, received: 123, sent: 456 }),
    ...overrides,
  };
}

describe('measured runtime telemetry', () => {
  it('samples actual system memory and supplied runtime boundaries without synthetic CPU values', async () => {
    const telemetry = createTelemetry(dependencies());
    try {
      const first = await telemetry.sample();
      expect(first.cpu).toBeNull();
      expect(first.memory.total).toBe(totalmem());
      expect(first.memory.used).toBeGreaterThanOrEqual(0);
      expect(first.memory.used).toBeLessThanOrEqual(first.memory.total);
      expect(first.memory.percent).toBeCloseTo(first.memory.used / first.memory.total * 100, 5);
      expect(first.network).toEqual({ online: true, clients: 3, received: 123, sent: 456 });
      expect(first.processes).toEqual([{ pid: process.pid, name: 'test runtime', role: 'desktop' }]);
      expect(first.activeJobs).toBe(2);
      expect(first.project.name).toBe('project');
      expect(first.obsidian.vaultPath).toBe('vault');
      expect(typeof first.time).toBe('number');
      expect(Math.abs(Date.now() - first.time)).toBeLessThan(5000);
      const second = await telemetry.sample();
      expect(second.cpu === null || (second.cpu >= 0 && second.cpu <= 100)).toBe(true);
      expect(second.heartbeat).toBe(first.heartbeat + 1);
    } finally { telemetry.dispose(); }
  });

  it('coalesces concurrent reads and resumes sampling after a rejected boundary', async () => {
    let release, calls = 0;
    const waiting = new Promise(resolve => { release = resolve; });
    const telemetry = createTelemetry(dependencies({ getProject: async () => { calls++; await waiting; return null; } }));
    const first = telemetry.sample(), second = telemetry.sample();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    release();
    expect((await first).project).toBeNull();
    await second;
    expect(calls).toBe(1);
    telemetry.dispose();
    await expect(telemetry.sample()).rejects.toThrow(/disposed|closed/i);

    let failed = false;
    const recovery = createTelemetry(dependencies({ getProject: async () => { if (!failed) { failed = true; throw new Error('read failed'); } return null; } }));
    await expect(recovery.sample()).rejects.toThrow('read failed');
    expect((await recovery.sample()).project).toBeNull();
    recovery.dispose();
  });
});
