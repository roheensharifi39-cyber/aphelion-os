import type { CSSProperties } from 'react';
import { House, MessageSquare, BookOpen, Workflow, Mic, Settings2, ArrowUpRight, Plus, Search, X, Copy, Check, Volume2, VolumeX, GitBranch, Terminal, Sparkles, Zap, Box, Play, Square, Folder, Moon, Save, Eye, Link, Sword, Pickaxe, FlaskConical } from 'lucide-react';
const icons = { home: House, chat: MessageSquare, book: BookOpen, flow: Workflow, mic: Mic, settings: Settings2, arrow: ArrowUpRight, plus: Plus, search: Search, x: X, copy: Copy, check: Check, sound: Volume2, mute: VolumeX, github: GitBranch, terminal: Terminal, spark: Sparkles, bolt: Zap, cube: Box, play: Play, stop: Square, folder: Folder, moon: Moon, save: Save, eye: Eye, link: Link, sword: Sword, pickaxe: Pickaxe, potion: FlaskConical };
export type IconName = keyof typeof icons;
export function PixelIcon({ name, size = 18, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  const Icon = icons[name];
  return <Icon size={size} className={`pixel-icon ${className}`} style={style} aria-hidden="true" strokeWidth={1.5} />;
}
export function GrassBlock({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true"><path fill="#a9d96f" d="m12 1 11 6-11 6L1 7z"/><path fill="#67964d" d="m1 7 11 6v11L1 18z"/><path fill="#476b3d" d="m12 13 11-6v11l-11 6z"/><path fill="#816346" d="m1 11 3 2v3l3-1 3 3 2-1v7L1 18z"/><path fill="#604b37" d="m12 17 3-2 3 1v-3l5-3v8l-11 6z"/><path fill="#bddf8b" d="m8 5 4-2 4 2-4 2z"/><path fill="#a38a5b" d="M4 16h2v2H4zm4 3h2v2H8z"/></svg>;
}
