import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParticleStudio } from '../lib/particle-field/engine';
import type { Session, VaultGraph } from '../types';
import { memoryLayout, seedForVault, vaultDevelopment } from '../lib/vault-visual';
import { PixelIcon } from './PixelIcon';
import { AgentNetwork } from './AgentNetwork';
import type { AgentActivity } from '../lib/agent-activity';

type Props = { active?: boolean; vaultPath: string; graph: VaultGraph | null; sessions: Session[]; selectedPath?: string | null; selectNote?: (path: string) => void; activities: AgentActivity[]; openSession: (id: string) => void; settings: () => void };
export function VaultField({ active = true, vaultPath, graph, sessions, selectedPath, selectNote, activities, openSession, settings }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<ParticleStudio | null>(null);
  const [error, setError] = useState(''), [initialized,setInitialized] = useState(false), [sceneReady,setSceneReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const pause = useRef(false), activeRef = useRef(active), ready = useRef(false), vaultRef = useRef(vaultPath);
  const anchors = useRef(new Map<string,HTMLButtonElement>()), down = useRef<{ x: number; y: number } | null>(null);
  activeRef.current = active; vaultRef.current = vaultPath;
  const nodes = useMemo(() => memoryLayout(graph,vaultPath,selectedPath),[graph,vaultPath,selectedPath]);
  const seed = seedForVault(vaultPath);
  useEffect(() => { pause.current = paused; studio.current?.setSpeed(paused || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.4); }, [paused]);
  useEffect(() => { if (initialized) studio.current?.setMemoryGraph(nodes,graph?.edges || []); },[initialized,nodes,graph?.edges]);
  useEffect(() => { if (initialized) studio.current?.setDevelopment(vaultDevelopment(graph,sessions)); },[initialized,graph,sessions]);
  useEffect(() => {
    const field = studio.current; if (!initialized || !field || !vaultPath) return;
    let cancelled = false;
    const hadForm = ready.current; ready.current = false; setSceneReady(false); setError(''); field.setSpeed(0);
    void field.showForm('neuron',seed,'morph').then(() => {
      if (cancelled) return;
      if (!hadForm || matchMedia('(prefers-reduced-motion: reduce)').matches) field.renderFrame(2.6);
      ready.current = true; setSceneReady(true); field.setSpeed(pause.current || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.4);
    }).catch(() => { if (!cancelled) setError('The vault visualization could not load. Your notes are still available.'); });
    return () => { cancelled = true; };
  },[initialized,seed,vaultPath]);
  useEffect(() => {
    let disposed = false, frame = 0, visible = false, last = performance.now();
    let resize: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
    let samples = 0, elapsed = 0, adjusted = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => { studio.current?.setSpeed(reduced.matches || pause.current ? 0 : 1.4); if (reduced.matches) studio.current?.setPointerActive(false); };
    const element = canvas.current!;
    const pointer = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === 'touch' || !activeRef.current) return;
      const rect = element.getBoundingClientRect();
      studio.current?.setPointer((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
      studio.current?.setPointerActive(true);
    };
    const leave = () => studio.current?.setPointerActive(false);
    const contextLost = (event: Event) => { event.preventDefault(); setError('The 3D view is unavailable. Your vault and agents are still accessible.'); };
    reduced.addEventListener('change', motion); element.addEventListener('pointermove',pointer,{passive:true}); element.addEventListener('pointerleave',leave); element.addEventListener('webglcontextlost',contextLost);
    void import('../lib/particle-field/engine').then(({ ParticleStudio }) => {
      if (disposed || !canvas.current || !host.current) return;
      const compact = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
      const field = new ParticleStudio(canvas.current,{ count: compact ? 150000 : 250000, size: 2.7, speed: 0, opacity: .7, bloomStrength: .75, bloomRadius: .08, bloomThreshold: .21, colorA: '#333333', colorB: '#ffffff', autorotate: false });
      studio.current = field;
      resize = new ResizeObserver(() => { if (!host.current) return; const {width,height}=host.current.getBoundingClientRect(); if (width&&height) field.resize(width,height,Math.min(devicePixelRatio||1,2)); });
      resize.observe(host.current);
      intersection = new IntersectionObserver(([entry]) => { visible=entry.isIntersecting; last=performance.now(); }); intersection.observe(host.current);
      setInitialized(true);
      const tick = (now: number) => {
        const rawDt=(now-last)/1000; last=now;
        if (visible&&!document.hidden&&ready.current) {
          const still=reduced.matches||pause.current;
          field.renderFrame(Math.min(.05,rawDt),still);
          for (const [path,button] of anchors.current) {
            const point=field.projectMemory(path);
            const show=activeRef.current&&point?.visible&&point.x>18&&point.y>80&&point.x<innerWidth-18&&point.y<innerHeight-120;
            button.style.visibility=show?'visible':'hidden';
            if (point) button.style.transform=`translate3d(${point.x}px,${point.y}px,0)`;
          }
          if (!still&&!compact&&!adjusted&&rawDt<.2) {
            elapsed+=rawDt; samples++;
            if (samples>=120) { adjusted=true; if (elapsed/samples>.042) { field.setCount(125000); void field.showForm('neuron',seedForVault(vaultRef.current),'morph').catch(() => { if (!disposed) setError('The scene quality could not be adjusted. Your vault remains available.'); }); } }
          }
        }
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    }).catch(() => { if (!disposed) setError('This device cannot display the 3D vault. You can still browse and edit your notes.'); });
    return () => { disposed=true;ready.current=false;cancelAnimationFrame(frame);resize?.disconnect();intersection?.disconnect();reduced.removeEventListener('change',motion);element.removeEventListener('pointermove',pointer);element.removeEventListener('pointerleave',leave);element.removeEventListener('webglcontextlost',contextLost);studio.current?.dispose();studio.current=null; };
  },[]);
  return <div className="vault-field immersive-field" ref={host} data-vault-seed={seed} data-ready={sceneReady}>
    <canvas ref={canvas} aria-label="Interactive black-and-white Neuron vault. Drag to orbit, move over the particles to displace them, or select a memory node."
      onPointerDown={event=>{down.current={x:event.clientX,y:event.clientY};}}
      onPointerUp={event=>{ const start=down.current;down.current=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;let nearest:string|null=null,distance=25;const rect=canvas.current!.getBoundingClientRect();for(const node of nodes){const p=studio.current?.projectMemory(node.path);if(!p?.visible)continue;const d=Math.hypot(event.clientX-rect.left-p.x,event.clientY-rect.top-p.y);if(d<distance){nearest=node.path;distance=d;}}if(nearest)selectNote?.(nearest); }} />
    <div className="vault-note-layer" aria-label="Vault memory nodes">{nodes.map(node=><button key={node.path} ref={element=>{if(element)anchors.current.set(node.path,element);else anchors.current.delete(node.path);}} style={{visibility:'hidden'}} className="vault-note-anchor" aria-label={`Inspect memory ${node.title}`} aria-pressed={selectedPath===node.path} onClick={()=>selectNote?.(node.path)}><span>{node.title}</span></button>)}</div>
    <AgentNetwork activities={activities} active={active} paused={paused} notes={graph?.total || 0} links={graph?.edges.length || 0} project={path => studio.current?.projectMemory(path) || null} openSession={openSession} settings={settings} selectNote={selectNote} />
    {error&&<p className="field-error" role="status">{error}</p>}
    <div className="field-controls" aria-label="Scene controls"><button aria-label="Zoom in to vault" onClick={()=>studio.current?.zoomBy(.85)}>+</button><button aria-label="Zoom out from vault" onClick={()=>studio.current?.zoomBy(1.15)}>−</button><button aria-label="Reset vault view" onClick={()=>studio.current?.resetView()}><PixelIcon name="eye" size={13}/></button><button aria-label={paused?'Resume vault motion':'Pause vault motion'} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}><PixelIcon name={paused?'play':'stop'} size={11}/><span>{paused?'Resume':'Pause'}</span></button></div>
  </div>;
}
