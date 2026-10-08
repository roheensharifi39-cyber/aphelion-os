import type { Agent } from '../types';
import { PixelIcon } from './PixelIcon';

export function AgentGlyph({ agent, size = 36 }: { agent: Agent; size?: number }) {
  return agent === 'claude' ? <PixelIcon name="spark" size={size} className="claude-glyph" /> : <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="codex-glyph" aria-hidden="true" shapeRendering="crispEdges"><path d="m12 1 10 6v11l-10 6-10-6V7z" stroke="currentColor" strokeWidth="1.6" /><path d="m2 7 10 6 10-6M12 13v11M6 4l10 6v9" stroke="currentColor" strokeWidth="1.4" /><path d="M1 6h2v2H1zm10-6h2v2h-2zm10 6h2v2h-2z" fill="currentColor" /></svg>;
}
export function CrystalIcon({ size = 35 }: { size?: number }) {
  return <svg width={size} height={size * 1.2} viewBox="0 0 28 34" className="crystal-icon" aria-hidden="true" shapeRendering="crispEdges"><path d="m13 1 5 7 5 3v7l3 3-5 5-7 8-7-7-5-8 2-9 5-4z" fill="#9760e2" /><path d="m13 1 1 14-8 5-2-10 5-4z" fill="#ba80fc" /><path d="m13 1 5 7-4 7z" fill="#ddb8ff" /><path d="m14 15 9-4v7l3 3-11 3z" fill="#7441b6" /><path d="m14 15 1 9-8 3-1-7z" fill="#a46ae5" /><path d="m15 24 6 2-7 8z" fill="#603596" /><path d="m7 27 8-3-1 10z" fill="#8550c4" /><path d="M12 4h2v4h-2zM6 11h2v4H6zm12 6h2v4h-2z" fill="#edceff" opacity=".7" /></svg>;
}
