import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';
import { iconCollapse, iconHand, iconNext, iconTeach } from '@/icons';
import { COACH_STEPS, useCoach } from '../coach.js';
import { setCoachPaused } from '../socket.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Track where an element is. The board resizes, the puzzle grid reflows, the scoreboard
 * grows a chip when a bot scores — so rather than guess at which of those warrants a
 * re-measure, poll at a rate no one can see. It's one getBoundingClientRect four times
 * a second.
 */
function useAnchorRect(anchor: string | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev &&
        Math.abs(prev.x - r.left) < 1 &&
        Math.abs(prev.y - r.top) < 1 &&
        Math.abs(prev.w - r.width) < 1 &&
        Math.abs(prev.h - r.height) < 1
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height },
      );
    };
    measure();
    const id = setInterval(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    }, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);

  return rect;
}

export default function CoachOverlay() {
  const index = useCoach((s) => s.index);
  const running = useCoach((s) => s.running);
  const minimised = useCoach((s) => s.minimised);
  const setMinimised = useCoach((s) => s.setMinimised);
  const next = useCoach((s) => s.next);
  const stop = useCoach((s) => s.stop);

  const step = running ? COACH_STEPS[index] : undefined;
  const rect = useAnchorRect(step?.anchor);

  // Some of these steps take a while to read, and reading shouldn't cost the player
  // their match. The clocks are held for exactly as long as a card is open — pressing
  // Next, Skip or minimise starts them again. (The server ignores this outside
  // practice, so it can't be used to freeze a real match.)
  const holdClocks = running && !minimised;
  useEffect(() => {
    setCoachPaused(holdClocks);
  }, [holdClocks]);
  // Nothing on screen means nothing to read, whatever route got us here.
  useEffect(
    () => () => {
      setCoachPaused(false);
    },
    [],
  );

  if (!step) return null;

  const waiting = step.advance.on === 'signal';
  // Folded away means "let me see the game", so the dark wash goes with it.
  const dim = step.dim !== false && !minimised;
  const pad = 6;

  const ring = rect ? (
    <div
      className="pointer-events-none fixed z-40 rounded-2xl border-2 border-primary transition-all duration-300 ease-out"
      style={{
        left: rect.x - pad,
        top: rect.y - pad,
        width: rect.w + pad * 2,
        height: rect.h + pad * 2,
        boxShadow: dim ? '0 0 0 9999px rgba(7, 5, 22, 0.72)' : undefined,
      }}
    />
  ) : dim ? (
    <div className="pointer-events-none fixed inset-0 z-40 bg-[rgba(7,5,22,0.72)]" />
  ) : null;

  if (minimised) {
    // Folded away, the top bar's mortarboard button is how the player gets this back.
    // A step that asked them to *do* something keeps one line on screen, because that
    // is the difference between a hidden tour and a player who doesn't know their turn.
    return (
      <>
        {ring}
        {step.action && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            <button
              key={step.id}
              type="button"
              onClick={() => setMinimised(false)}
              className="animate-rise card-shadow pointer-events-auto flex w-full max-w-[32rem] items-center gap-3 rounded-xl border-2 border-primary bg-card px-4 py-3 text-left"
            >
              <FontAwesomeIcon
                icon={iconHand}
                className="animate-breathe shrink-0 text-primary"
              />
              <span className="flex-1 text-[0.95rem] font-extrabold text-primary">
                {step.action}
              </span>
              <span className="shrink-0 text-xs font-bold text-muted-foreground tnum">
                {index + 1}/{COACH_STEPS.length}
              </span>
            </button>
          </div>
        )}
      </>
    );
  }

  // Keep the card away from whatever is being pointed at, so the highlight is never
  // hidden behind the explanation of it.
  const anchorLow = rect ? rect.y + rect.h > window.innerHeight * 0.55 : false;

  return (
    <>
      {ring}

      <div
        className={cn(
          'fixed inset-x-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5',
          anchorLow ? 'top-0 pt-3 sm:pt-5' : 'bottom-0',
        )}
      >
        <div
          key={step.id}
          className="animate-rise card-shadow pointer-events-auto flex max-h-[58vh] w-full max-w-[32rem] flex-col rounded-xl border-2 border-primary bg-card p-3.5 sm:max-h-[70vh] sm:p-5"
        >
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-fill text-primary-fill-foreground sm:size-8">
              <FontAwesomeIcon icon={iconTeach} className="text-xs sm:text-sm" />
            </span>
            <h3 className="min-w-0 flex-1 text-base leading-tight font-extrabold sm:text-xl">
              {step.title}
            </h3>
            <span className="shrink-0 text-xs font-bold text-muted-foreground tnum">
              {index + 1}/{COACH_STEPS.length}
            </span>
            <button
              type="button"
              onClick={() => setMinimised(true)}
              aria-label="Minimise the instructions"
              className="-mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <FontAwesomeIcon icon={iconCollapse} className="text-sm" />
            </button>
          </div>

          {/* Only the prose scrolls, so the buttons can't be pushed off a short screen. */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {step.body && (
              <p className="mt-2 text-sm leading-snug text-muted-foreground sm:text-[0.95rem] sm:leading-relaxed">
                {step.body}
              </p>
            )}

            {step.action && (
              <p className="animate-pop mt-2.5 flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-sm font-extrabold text-primary">
                <FontAwesomeIcon icon={iconHand} className="animate-breathe shrink-0" />
                {step.action}
              </p>
            )}
          </div>

          <div className="mt-3 flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={stop}
              className="text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip the tour
            </button>
            <div className="ml-auto">
              {waiting ? (
                <button
                  type="button"
                  onClick={() => setMinimised(true)}
                  className="flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="size-2 animate-flash rounded-full bg-primary" />
                  {/* Only claim it's their move when we've actually asked for one. */}
                  {step.action ? 'your move' : 'watching…'}
                </button>
              ) : (
                <Button onClick={next} className="h-11 px-6 font-extrabold">
                  {index === COACH_STEPS.length - 1 ? 'Got it' : 'Next'}
                  <FontAwesomeIcon icon={iconNext} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
