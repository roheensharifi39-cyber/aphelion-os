import type { CSSProperties } from 'react';
import type { Agent } from '../types';
export type WorkerKind = Agent | 'vault' | 'system';
const colors = { claude: ['#ffd066', '#bf751f', '#764616'], codex: ['#54e9ff', '#147da2', '#104358'], vault: ['#d3a0ff', '#8249c0', '#442270'], system: ['#72ffd0', '#169975', '#105444'] };
export function WorkerFigure({ kind, working = false, carrying = false }: { kind: WorkerKind; working?: boolean; carrying?: boolean }) {
  const [light, middle, dark] = colors[kind];
  return <g className={`voxel-worker ${kind} ${working ? 'is-working' : 'is-idle'} ${carrying ? 'carrying' : ''}`} style={{ '--worker-light': light, '--worker-mid': middle, '--worker-dark': dark } as CSSProperties}>
    <ellipse cx="25" cy="68" rx="19" ry="6" fill="#020b12" opacity=".65" />
    <g className="worker-leg left"><path d="M13 46 25 49V66L13 62Z" fill={dark} stroke={middle} /><path d="M13 60 25 63V69L10 65V61Z" fill="#20333d" stroke={light} strokeWidth=".4" /></g>
    <g className="worker-leg right"><path d="M26 49 38 43V61L26 67Z" fill={middle} stroke={light} strokeWidth=".5" /><path d="M26 62 38 57 41 60V65L26 71Z" fill="#172c37" stroke={light} strokeWidth=".4" /></g>
    <path d="M11 29 25 23 40 29 26 36Z" fill={light} /><path d="M11 29 26 36V51L11 44Z" fill={middle} stroke={light} strokeWidth=".6" /><path d="M26 36 40 29V44L26 51Z" fill={dark} stroke={middle} />
    <path d="M14 36 21 39V43L14 40Z" fill={light} opacity=".8" /><path d="M30 37 36 34V40L30 43Z" fill="#0c2933" />
    <g className="worker-arm back"><path d="M36 28 44 31V46L36 43Z" fill={middle} /><path d="M36 42 44 45V52L36 49Z" fill="#dfb294" /></g>
    <g className="worker-head"><path d="M10 5 25 0 41 8 26 15Z" fill={light} stroke={light} /><path d="M10 5 26 15V30L10 22Z" fill="#dfb294" stroke="#916858" strokeWidth=".5" /><path d="M26 15 41 8V23L26 30Z" fill="#a77760" /><path d="M10 5 25 0 41 8 26 15 10 8Z" fill={middle} /><path d="M10 5V11L26 20V14Z" fill={light} /><path d="M26 14 41 8V13L26 20Z" fill={dark} />
      <g className="worker-eyes"><path d="M13 15 17 17V20L13 18Z M21 19 24 21V24L21 22Z" fill="#14222e" /><path d="M14 15 16 16V18L14 17Z M22 20 24 21V23L22 22Z" fill="#f4fff9" /></g><path d="M18 23 23 26V28L18 25Z" fill="#784f40" />
      {kind === 'codex' && <path d="M34 9 40 6V17L34 20Z" fill="#00ffff" stroke="#bbfcff" strokeWidth=".5" />}{kind === 'vault' && <path d="M11 4 25-5 40 3 26 10Z" fill="#b582ee" />}
    </g>
    <g className="worker-arm front"><path d="M6 27 14 31V43L6 39Z" fill={light} stroke={middle} strokeWidth=".6" /><path d="M6 39 14 43V50L6 46Z" fill="#edc4a0" />
      {carrying ? <g className="worker-book"><path d="M0 38 11 42 11 51 0 47Z" fill="#e1c8ff" stroke="#ac7de3" /><path d="M2 41 8 43M2 44 8 46" stroke="#72359f" /></g> : <g className="worker-tool"><path d="M11 45 24 25" stroke="#6e5139" strokeWidth="3" /><path d="M18 21 29 26 32 32 27 30 22 26 16 25Z" fill={light} stroke={dark} /></g>}
    </g>
    {working && <g className="worker-sparks" fill={light}><rect x="-1" y="22" width="2" height="2" /><rect x="31" y="33" width="3" height="3" /><rect x="2" y="14" width="2" height="2" /></g>}
  </g>;
}
export function MinecraftWorker({ kind, working = false }: { kind: WorkerKind; working?: boolean }) {
  return <svg className={`worker-avatar ${kind} ${working ? 'working' : ''}`} viewBox="-8 -9 64 86" aria-hidden="true"><WorkerFigure kind={kind} working={working} carrying={kind === 'claude' || kind === 'vault'} /></svg>;
}
