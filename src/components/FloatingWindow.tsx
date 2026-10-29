import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Grip, Minus, Maximize2, X } from 'lucide-react';
import type { WindowLayout } from '../types';
import { constrainWindow } from '../lib/desktop';

type Props = { title: string; label: string; layout: WindowLayout; order: number; className?: string; children: ReactNode; toolbar?: ReactNode; rename?: (title: string) => void; change: (layout: WindowLayout) => void; focus: () => void };
export function FloatingWindow(p: Props) {
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const [preview, setPreview] = useState<WindowLayout | null>(null);
  const drag = useRef<{ x: number; y: number; layout: WindowLayout; resize: boolean } | null>(null);
  const layout = constrainWindow(preview || p.layout, viewport.width, viewport.height);
  useEffect(() => { const resize = () => setViewport({width:innerWidth,height:innerHeight}); window.addEventListener('resize',resize); return () => window.removeEventListener('resize',resize); },[]);
  const moveBy = (x: number,y: number,resize = false) => p.change(constrainWindow({...layout, ...(resize ? {width:layout.width+x,height:layout.height+y} : {x:layout.x+x,y:layout.y+y})},viewport.width,viewport.height));
  const handle = (resize: boolean) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { if (event.button !== 0) return; event.preventDefault(); p.focus(); drag.current={x:event.clientX,y:event.clientY,layout,resize}; event.currentTarget.setPointerCapture(event.pointerId); },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => { const start=drag.current;if(!start)return;const x=event.clientX-start.x,y=event.clientY-start.y;setPreview(constrainWindow({...start.layout,...(start.resize?{width:start.layout.width+x,height:start.layout.height+y}:{x:start.layout.x+x,y:start.layout.y+y})},viewport.width,viewport.height)); },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => { if(!drag.current)return; const start=drag.current;drag.current=null; const x=event.clientX-start.x,y=event.clientY-start.y;p.change(constrainWindow({...start.layout,...(start.resize?{width:start.layout.width+x,height:start.layout.height+y}:{x:start.layout.x+x,y:start.layout.y+y})},viewport.width,viewport.height));setPreview(null); },
    onLostPointerCapture: () => { drag.current=null;setPreview(null); },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => { const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const direction=directions[event.key];if(!direction)return;event.preventDefault();const step=event.shiftKey?40:10;moveBy(direction[0]*step,direction[1]*step,resize); }
  });
  return <section className={`floating-window ${p.className || ''} ${p.layout.minimized?'is-minimized':''}`} aria-label={p.label} style={{left:layout.x,top:layout.y,width:layout.width,height:p.layout.minimized?46:layout.height,zIndex:20+p.order}} onPointerDownCapture={p.focus}>
    <header className="floating-window-header"><button className="window-drag" aria-label={`Move ${p.title}`} title="Drag to move · arrow keys also move this window" {...handle(false)}><Grip size={15}/></button>{p.rename?<input aria-label={`Rename ${p.title}`} value={p.title} maxLength={80} onChange={event=>p.rename?.(event.target.value)} onBlur={()=>{if(!p.title.trim())p.rename?.('Untitled conversation');}}/>:<span className="window-title">{p.title}</span>}<button aria-label={`${p.layout.minimized?'Restore':'Minimize'} ${p.title}`} onClick={()=>p.change({...p.layout,minimized:!p.layout.minimized})}>{p.layout.minimized?<Maximize2 size={14}/>:<Minus size={14}/>}</button><button aria-label={`Close ${p.title}`} title="Close window · conversation stays saved" onClick={()=>p.change({...p.layout,open:false})}><X size={15}/></button></header>
    {!p.layout.minimized&&<>{p.toolbar&&<div className="floating-window-toolbar">{p.toolbar}</div>}<div className="floating-window-content">{p.children}</div><button className="window-resize" aria-label={`Resize ${p.title}`} title="Drag to resize · arrow keys also resize" {...handle(true)}><Maximize2 size={12}/></button></>}
  </section>;
}
