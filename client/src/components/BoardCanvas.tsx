import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { BOARD_W, BOARD_H, hitTest } from '@game/shared';
import type { NumberToken, RoomState } from '@game/shared';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';
import { iconZoomIn, iconZoomOut, iconFit } from '@/icons';

const REVEAL_MS = 3200;
const DEAL_MS = 700;
const MAX_ZOOM = 6;
/** A pointer that moves further than this was a drag, not a tap. */
const TAP_SLOP_PX = 8;

export type BoardMode = 'pick' | 'hunt' | 'idle';

interface Props {
  tokens: NumberToken[];
  reveal: RoomState['lastReveal'];
  /** `pick` = the caller choosing, `hunt` = looking for the called number. */
  mode: BoardMode;
  /** Locked out after a wrong click. */
  locked: boolean;
  onPick: (x: number, y: number) => void;
}

interface View {
  /** Multiplier on top of the fit-to-screen scale. */
  zoom: number;
  /** Pan offset in board units. */
  px: number;
  py: number;
}

const FIT: View = { zoom: 1, px: 0, py: 0 };

/**
 * The board is a wide 16:10 rectangle. Fitting all of it into a tall, narrow viewport —
 * a phone, or a tablet held upright — shrinks the numbers to nothing and leaves empty
 * bands above and below. In that shape we start zoomed so the board covers the viewport
 * and the player pans sideways. On a wide screen the whole board is visible at once,
 * which is how it should be, and either way anyone can zoom back out to see all of it.
 */
const TALL_VIEWPORT_RATIO = 0.75;
const MAX_DEFAULT_ZOOM = 3.5;

function baseZoom(w: number, h: number): number {
  if (w === 0 || h === 0 || h / w < TALL_VIEWPORT_RATIO) return 1;
  const contain = Math.min(w / BOARD_W, h / BOARD_H);
  const cover = Math.max(w / BOARD_W, h / BOARD_H);
  return Math.min(MAX_DEFAULT_ZOOM, Math.max(1, cover / contain));
}

/**
 * The numbers are painted on a canvas rather than laid out as DOM nodes. Partly for
 * throughput with 150 rotated labels, but mainly so a player can't just hit Ctrl+F
 * and have the browser find the called number for them.
 *
 * Every player sees the same fixed board, which is what keeps the race fair. On a phone
 * that board is too small to read at fit-to-screen, so it can be pinched and dragged —
 * the layout never changes, only your window onto it.
 */
function BoardCanvas({ tokens, reveal, mode, locked, onPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [view, setView] = useState<View>(FIT);
  /** Once the player zooms or pans themselves, stop re-deriving the default for them. */
  const userAdjusted = useRef(false);
  const revealStartedAt = useRef(0);
  const revealRef = useRef<Props['reveal']>(null);
  const dealStartedAt = useRef(Date.now());
  const lastRevealKey = useRef('');

  // Pointer bookkeeping for drag-to-pan and pinch-to-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // A drag fires pointermove far faster than the screen refreshes, and every one of
  // those would otherwise repaint the board. Coalesce them into one frame.
  const pendingView = useRef<View | null>(null);
  const panRaf = useRef(0);
  const gesture = useRef<{
    startX: number;
    startY: number;
    moved: number;
    startView: View;
    pinchDist: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      setSize({ w, h });
      // Re-derive the default whenever the room we have changes shape — rotating a phone
      // should land on a sensible view rather than whatever suited the old orientation.
      if (!userAdjusted.current && w > 0 && h > 0) {
        setView({ ...FIT, zoom: baseZoom(w, h) });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (panRaf.current) cancelAnimationFrame(panRaf.current);
    };
  }, []);

  const schedulePan = useCallback((next: View) => {
    pendingView.current = next;
    if (panRaf.current) return;
    panRaf.current = requestAnimationFrame(() => {
      panRaf.current = 0;
      if (pendingView.current) setView(pendingView.current);
    });
  }, []);

  // `reveal` is deserialised fresh out of every state broadcast, so its identity changes
  // constantly even when nothing about it has. Key the redraw off its contents instead,
  // or the board would repaint 150 rotated labels on every score change.
  const revealKey = reveal ? `${reveal.value}@${reveal.x},${reveal.y}` : '';
  revealRef.current = reveal;
  if (revealKey && revealKey !== lastRevealKey.current) {
    lastRevealKey.current = revealKey;
    revealStartedAt.current = Date.now();
  }

  /** Fit scale, then the view's zoom on top, plus the pan offset. */
  const geometry = useCallback(
    (v: View = view) => {
      const fit = Math.min(size.w / BOARD_W, size.h / BOARD_H);
      const scale = fit * v.zoom;
      return {
        scale,
        offX: (size.w - BOARD_W * scale) / 2 + v.px * scale,
        offY: (size.h - BOARD_H * scale) / 2 + v.py * scale,
      };
    },
    [size, view],
  );

  /** Keep the board from being dragged off into empty space. */
  const clampView = useCallback(
    (v: View): View => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
      const fit = Math.min(size.w / BOARD_W, size.h / BOARD_H);
      const scale = fit * zoom;
      // How much board sticks out past the viewport, in board units.
      const slackX = Math.max(0, (BOARD_W * scale - size.w) / 2 / scale);
      const slackY = Math.max(0, (BOARD_H * scale - size.h) / 2 / scale);
      return {
        zoom,
        px: Math.min(slackX, Math.max(-slackX, v.px)),
        py: Math.min(slackY, Math.max(-slackY, v.py)),
      };
    },
    [size],
  );

  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const { scale, offX, offY } = geometry();
      const x = (clientX - rect.left - offX) / scale;
      const y = (clientY - rect.top - offY) / scale;
      if (x < 0 || y < 0 || x > BOARD_W || y > BOARD_H) return null;
      return { x, y };
    },
    [geometry],
  );

  /** Zoom about a fixed point so the board doesn't slide out from under your finger. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      userAdjusted.current = true;
      setView((v) => {
        const canvas = canvasRef.current;
        const next = { ...v, zoom: Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor)) };
        if (canvas && clientX !== undefined && clientY !== undefined) {
          const rect = canvas.getBoundingClientRect();
          const fit = Math.min(size.w / BOARD_W, size.h / BOARD_H);
          const anchorX = (clientX - rect.left - size.w / 2) / (fit * v.zoom);
          const anchorY = (clientY - rect.top - size.h / 2) / (fit * v.zoom);
          next.px = v.px + anchorX * (1 - v.zoom / next.zoom);
          next.py = v.py + anchorY * (1 - v.zoom / next.zoom);
        }
        return clampView(next);
      });
    },
    [size, clampView],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;

    // Cap the backing store rather than trusting devicePixelRatio: a 3x phone with a
    // big viewport would otherwise ask a weak GPU to fill several million pixels a frame.
    const MAX_PIXELS = 2_600_000;
    const raw = Math.min(window.devicePixelRatio || 1, 2);
    const dpr = Math.min(raw, Math.sqrt(MAX_PIXELS / Math.max(1, size.w * size.h)));
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const now = Date.now();
      const { scale, offX, offY } = geometry();

      // What part of the board is actually on screen, in board units. Everything
      // outside this is skipped — when zoomed in that's most of the board.
      const viewL = -offX / scale;
      const viewT = -offY / scale;
      const viewR = viewL + size.w / scale;
      const viewB = viewT + size.h / scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = '#0d1013';
      ctx.fillRect(0, 0, size.w, size.h);

      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(scale, scale);

      // Board surface with a faint grid so it reads as a playfield, not a void.
      ctx.fillStyle = '#121620';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);

      // One path for every grid line, and only the lines in view.
      ctx.strokeStyle = 'rgba(255,255,255,0.022)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      const gx0 = Math.max(100, Math.floor(viewL / 100) * 100);
      for (let gx = gx0; gx < Math.min(BOARD_W, viewR + 100); gx += 100) {
        ctx.moveTo(gx, Math.max(0, viewT));
        ctx.lineTo(gx, Math.min(BOARD_H, viewB));
      }
      const gy0 = Math.max(100, Math.floor(viewT / 100) * 100);
      for (let gy = gy0; gy < Math.min(BOARD_H, viewB + 100); gy += 100) {
        ctx.moveTo(Math.max(0, viewL), gy);
        ctx.lineTo(Math.min(BOARD_W, viewR), gy);
      }
      ctx.stroke();

      const dealProgress = Math.min(1, (now - dealStartedAt.current) / DEAL_MS);
      const dealing = dealProgress < 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const alpha = locked ? 0.35 : 1;
      let hoveredToken: NumberToken | null = null;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];

        // Cull: a token whose box is off screen costs nothing to skip and a rotated
        // text draw to keep. The margin covers the tilt and the deal-in scale.
        const half = t.fontSize * String(t.value).length * 0.5;
        if (t.x + half < viewL || t.x - half > viewR) continue;
        if (t.y + t.fontSize < viewT || t.y - t.fontSize > viewB) continue;

        // Numbers flutter in on a short stagger rather than all appearing at once.
        const start = (i / Math.max(1, tokens.length)) * 0.55;
        const local = Math.min(1, Math.max(0, (dealProgress - start) / 0.45));
        if (local <= 0) continue;

        if (hoverId === t.id && !locked) {
          // Drawn last, so its glow sits over its neighbours instead of under them.
          hoveredToken = t;
          continue;
        }

        const eased = 1 - Math.pow(1 - local, 3);
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate((t.rotation * Math.PI) / 180);
        if (dealing) ctx.scale(0.8 + 0.2 * eased, 0.8 + 0.2 * eased);
        ctx.globalAlpha = alpha * eased;
        ctx.font = `700 ${t.fontSize}px Inter, "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = t.color;
        ctx.fillText(String(t.value), 0, 0);
        ctx.restore();
      }

      if (hoveredToken) {
        const t = hoveredToken;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.font = `700 ${t.fontSize}px Inter, "Segoe UI", system-ui, sans-serif`;
        // Picking is a deliberate choice, so make the target unmistakable.
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(t.value), 0, 0);
        ctx.restore();
      }

      // Where the last round's number was hiding.
      const reveal = revealRef.current;
      let revealing = false;
      if (reveal) {
        const age = now - revealStartedAt.current;
        if (age < REVEAL_MS) {
          revealing = true;
          const p = age / REVEAL_MS;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - p);
          ctx.strokeStyle = '#2dd4bf';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(reveal.x, reveal.y, 24 + p * 110, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '700 42px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#2dd4bf';
          ctx.fillText(String(reveal.value), reveal.x, reveal.y - 62);
          ctx.restore();
        }
      }

      ctx.restore();
      if (dealing || revealing) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [tokens, size, revealKey, locked, hoverId, geometry]);

  const interactive = (mode === 'pick' || mode === 'hunt') && !locked;

  /* --------------------------------------------------------------- gestures */

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      gesture.current = {
        startX: e.clientX,
        startY: e.clientY,
        moved: 0,
        startView: view,
        pinchDist: 0,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        startX: (a.x + b.x) / 2,
        startY: (a.y + b.y) / 2,
        moved: TAP_SLOP_PX + 1, // a pinch is never a tap
        startView: view,
        pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
      };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) {
      // Plain mouse hover: highlight what the caller is about to pick.
      if (mode === 'pick' && !locked) {
        const pt = toBoard(e.clientX, e.clientY);
        setHoverId(pt ? (hitTest(tokens, pt.x, pt.y)?.id ?? null) : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0) {
        const factor = dist / g.pinchDist;
        g.pinchDist = dist;
        zoomAt(factor, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    g.moved = Math.max(g.moved, Math.hypot(dx, dy));
    // Only pan once zoomed in; at fit-to-screen there is nowhere to go.
    if (g.startView.zoom > 1 && g.moved > TAP_SLOP_PX) {
      userAdjusted.current = true;
      const { scale } = geometry(g.startView);
      schedulePan(
        clampView({
          ...g.startView,
          px: g.startView.px + dx / scale,
          py: g.startView.py + dy / scale,
        }),
      );
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);

    if (pointers.current.size === 0) {
      gesture.current = null;
      // A press that didn't travel is a tap: that's a pick or a hunt.
      if (g && g.moved <= TAP_SLOP_PX && interactive) {
        const pt = toBoard(e.clientX, e.clientY);
        if (pt) onPick(pt.x, pt.y);
      }
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  }

  const zoomed = view.zoom > baseZoom(size.w, size.h) + 0.01;
  const pannable = view.zoom > 1.01;

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden rounded-xl border transition-colors duration-300',
        mode === 'pick' ? 'border-primary/60' : 'border-border',
        locked && 'border-destructive/70',
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'block touch-none',
          interactive ? 'cursor-crosshair' : 'cursor-default',
          pannable && 'cursor-grab',
          locked && 'cursor-not-allowed',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
        onWheel={onWheel}
      />

      {/* Zoom controls: essential on a phone, handy on a laptop. */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <Button
          variant="secondary"
          size="icon-sm"
          className="border border-border bg-card/90 backdrop-blur"
          onClick={() => zoomAt(1.4)}
          aria-label="Zoom in"
        >
          <FontAwesomeIcon icon={iconZoomIn} />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          className="border border-border bg-card/90 backdrop-blur"
          onClick={() => zoomAt(1 / 1.4)}
          aria-label="Zoom out"
          disabled={!zoomed}
        >
          <FontAwesomeIcon icon={iconZoomOut} />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          className="border border-border bg-card/90 backdrop-blur"
          onClick={() => {
            userAdjusted.current = false;
            setView({ ...FIT, zoom: baseZoom(size.w, size.h) });
          }}
          aria-label="Reset the view"
          disabled={!zoomed}
        >
          <FontAwesomeIcon icon={iconFit} />
        </Button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
        {mode === 'pick' ? (
          <span className="animate-rise rounded-full border border-primary/40 bg-card/90 px-3 py-1.5 text-center text-[0.7rem] font-medium tracking-wide text-primary backdrop-blur sm:text-xs">
            Tap any number to call it
          </span>
        ) : pannable ? (
          <span className="rounded-full border border-border bg-card/90 px-3 py-1.5 text-[0.7rem] text-muted-foreground backdrop-blur">
            drag to look around · {view.zoom.toFixed(1)}×
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The board only cares about its own props. Memoising it keeps the once-a-second clock
 * ticks in the parent from walking the whole component for nothing.
 */
export default memo(BoardCanvas);
