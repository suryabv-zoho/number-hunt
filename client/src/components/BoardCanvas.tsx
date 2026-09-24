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
/**
 * How far a pointer may travel and still count as a tap rather than a drag.
 * A finger always slides a little, so touch gets a much bigger allowance than a mouse —
 * 8px was tight enough that real taps were being swallowed as pans.
 */
const TAP_SLOP_MOUSE = 6;
const TAP_SLOP_TOUCH = 16;

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
  /** Set while a pinch is in progress and for a moment after, so the finger lifting
   *  off a two-finger gesture never lands as a tap on a number. */
  const pinchUntil = useRef(0);
  const gesture = useRef<{
    startX: number;
    startY: number;
    moved: number;
    startView: View;
    pinchDist: number;
    slop: number;
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
      ctx.fillStyle = '#131029';
      ctx.fillRect(0, 0, size.w, size.h);

      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(scale, scale);

      // Board surface, lifted just enough off the page to read as a playfield.
      ctx.fillStyle = '#1a1638';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);

      // One path for every grid line, and only the lines in view.
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
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

      const alpha = locked ? 0.3 : 1;
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
        ctx.font = `800 ${t.fontSize}px Nunito, ui-rounded, "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = t.color;
        ctx.fillText(String(t.value), 0, 0);
        ctx.restore();
      }

      if (hoveredToken) {
        const t = hoveredToken;
        const label = String(t.value);
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.font = `800 ${t.fontSize}px Nunito, ui-rounded, "Segoe UI", system-ui, sans-serif`;
        // Picking is deliberate, so make the target unmistakable — a filled brand pill
        // behind it, since a glow does nothing on a pale surface.
        const w = ctx.measureText(label).width;
        const padX = t.fontSize * 0.32;
        const padY = t.fontSize * 0.28;
        const r = t.fontSize * 0.45;
        ctx.beginPath();
        ctx.roundRect(-w / 2 - padX, -t.fontSize / 2 - padY, w + padX * 2, t.fontSize + padY * 2, r);
        ctx.fillStyle = '#8466ff';
        ctx.fill();
        ctx.fillStyle = '#140f30';
        ctx.fillText(label, 0, 0);
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
          ctx.strokeStyle = '#ffc94d';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(reveal.x, reveal.y, 24 + p * 110, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '800 42px Nunito, ui-rounded, system-ui, sans-serif';
          ctx.fillStyle = '#ffc94d';
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

    const slop = e.pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH;

    if (pointers.current.size === 1) {
      gesture.current = {
        startX: e.clientX,
        startY: e.clientY,
        moved: 0,
        startView: view,
        pinchDist: 0,
        slop,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchUntil.current = Date.now() + 600;
      gesture.current = {
        startX: (a.x + b.x) / 2,
        startY: (a.y + b.y) / 2,
        moved: Number.MAX_SAFE_INTEGER, // a pinch is never a tap
        startView: view,
        pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
        slop,
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
        pinchUntil.current = Date.now() + 600;
        zoomAt(factor, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    g.moved = Math.max(g.moved, Math.hypot(dx, dy));
    // Only pan once zoomed in; at fit-to-screen there is nowhere to go.
    if (g.startView.zoom > 1 && g.moved > g.slop) {
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
      // A press that didn't travel is a tap: that's a pick or a hunt. Lifting the last
      // finger off a pinch must never count, hence the short cooling-off window.
      const justPinched = Date.now() < pinchUntil.current;
      if (g && !justPinched && g.moved <= g.slop && interactive) {
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
        'card-shadow relative min-h-0 flex-1 overflow-hidden rounded-xl border-2 bg-card transition-colors duration-300',
        mode === 'pick' ? 'border-primary' : 'border-border',
        locked && 'border-destructive',
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

      {/* Zoom controls. Sized for a thumb, not a cursor — these are the main way a
          phone player navigates the board. */}
      <div className="absolute top-2 right-2 flex flex-col gap-1.5">
        <ZoomButton icon={iconZoomIn} label="Zoom in" onClick={() => zoomAt(1.4)} />
        <ZoomButton
          icon={iconZoomOut}
          label="Zoom out"
          onClick={() => zoomAt(1 / 1.4)}
          disabled={!zoomed}
        />
        <ZoomButton
          icon={iconFit}
          label="Reset the view"
          disabled={!zoomed}
          onClick={() => {
            userAdjusted.current = false;
            setView({ ...FIT, zoom: baseZoom(size.w, size.h) });
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
        {mode === 'pick' ? (
          <span className="animate-rise rounded-full bg-primary px-4 py-2 text-center text-sm font-extrabold text-primary-foreground shadow-lg">
            Tap any number to call it
          </span>
        ) : pannable ? (
          <span className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-bold text-muted-foreground">
            drag to look around · {view.zoom.toFixed(1)}×
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ZoomButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof iconZoomIn;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="size-11 rounded-full border border-border bg-surface p-0 text-foreground shadow-md hover:bg-surface-2 disabled:opacity-40"
    >
      <FontAwesomeIcon icon={icon} className="text-base" />
    </Button>
  );
}

/**
 * The board only cares about its own props. Memoising it keeps the once-a-second clock
 * ticks in the parent from walking the whole component for nothing.
 */
export default memo(BoardCanvas);
