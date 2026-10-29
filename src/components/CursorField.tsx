import { useEffect, useRef } from 'react';

// An additive ghost trail; the system cursor is always untouched.
export function CursorField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const context = canvas.getContext('2d');
    if (!context) return;
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let stop = () => {};
    const reconcile = () => {
      stop();
      canvas.hidden = !fine.matches || reduced.matches;
      if (canvas.hidden) return;
      let width = 0, height = 0, frame = 0, active = false, interactive = false;
      const pointer = { x: -1000, y: -1000 };
      const ghosts = Array.from({ length: 6 }, () => ({ ...pointer }));
      const arrow = new Path2D('M0 0L0 20L5.3 15.7L9.3 24L13 22.2L9 14L16 14Z');
      const resize = () => {
        width = innerWidth; height = innerHeight;
        const dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const move = (event: PointerEvent) => {
        if (!active) ghosts.forEach(point => { point.x = event.clientX; point.y = event.clientY; });
        active = true; pointer.x = event.clientX; pointer.y = event.clientY;
        interactive = event.target instanceof Element && !!event.target.closest('a, button, input');
      };
      const leave = () => { active = false; };
      const render = () => {
        context.clearRect(0, 0, width, height);
        if (active && !document.hidden) {
          let previous = pointer;
          ghosts.forEach((ghost, i) => {
            const follow = .26 / (1 + i * .18);
            ghost.x += (previous.x - ghost.x) * follow; ghost.y += (previous.y - ghost.y) * follow;
            const distance = Math.hypot(pointer.x - ghost.x, pointer.y - ghost.y);
            context.save(); context.translate(ghost.x, ghost.y); context.scale(26 / 24, 26 / 24);
            context.filter = `blur(${i / 5 * 5}px)`;
            context.globalAlpha = (interactive ? .24 : .18) * (1 - i / 7) * Math.min(1, distance / 13);
            context.fillStyle = '#fff'; context.fill(arrow); context.restore(); previous = ghost;
          });
        }
        frame = requestAnimationFrame(render);
      };
      resize();
      window.addEventListener('resize', resize); window.addEventListener('pointermove', move);
      document.documentElement.addEventListener('pointerleave', leave); window.addEventListener('blur', leave);
      frame = requestAnimationFrame(render);
      stop = () => {
        cancelAnimationFrame(frame); context.clearRect(0, 0, width, height);
        window.removeEventListener('resize', resize); window.removeEventListener('pointermove', move);
        document.documentElement.removeEventListener('pointerleave', leave); window.removeEventListener('blur', leave);
      };
    };
    reconcile(); fine.addEventListener('change', reconcile); reduced.addEventListener('change', reconcile);
    return () => { stop(); fine.removeEventListener('change', reconcile); reduced.removeEventListener('change', reconcile); };
  }, []);
  return <canvas ref={ref} className="cursor-field" aria-hidden="true" />;
}
