import { cpus, freemem, totalmem } from 'node:os';

function cpuCounters() {
  return cpus().reduce((sum, cpu) => ({
    idle: sum.idle + cpu.times.idle,
    total: sum.total + Object.values(cpu.times).reduce((total, time) => total + time, 0),
  }), { idle: 0, total: 0 });
}

export function createTelemetry({ getProcesses, getActiveJobs, getProject, getObsidian, getNetwork }) {
  let previous = null, pending = null, disposed = false, heartbeat = 0;
  async function measure() {
    const current = cpuCounters();
    const totalDelta = previous ? current.total - previous.total : 0;
    const idleDelta = previous ? current.idle - previous.idle : 0;
    const cpu = previous && totalDelta > 0 && idleDelta >= 0
      ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
    previous = current;
    const total = totalmem(), used = Math.max(0, Math.min(total, total - freemem()));
    const [project, obsidian] = await Promise.all([getProject(), getObsidian()]);
    if (disposed) throw new Error('Telemetry is disposed.');
    return {
      time: Date.now(),
      cpu,
      memory: { used, total, percent: total ? used / total * 100 : 0 },
      network: { ...getNetwork() },
      processes: getProcesses().map(process => ({ ...process })),
      activeJobs: getActiveJobs(),
      project,
      obsidian,
      heartbeat: ++heartbeat,
    };
  }
  return {
    sample() {
      if (disposed) return Promise.reject(new Error('Telemetry is disposed.'));
      if (!pending) pending = measure().finally(() => { pending = null; });
      return pending;
    },
    dispose() { disposed = true; },
  };
}
