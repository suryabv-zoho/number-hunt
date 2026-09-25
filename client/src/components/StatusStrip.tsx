import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn } from 'cn';
import { iconFound, iconHunt, iconPick, iconWrong } from '@/icons';
import { useStore } from '../store.js';
import { formatClock, useNow } from '../hooks.js';

/**
 * The band above the board. Only two people ever see it: the caller while they choose,
 * and hunters once a number is in play — everyone else gets the waiting screen.
 */
export default function StatusStrip() {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const lockedUntil = useStore((s) => s.lockedUntil);
  // Only runs while there is a lockout counting down; idle the rest of the time.
  const now = useNow(500, lockedUntil > Date.now());

  const isCaller = room.currentCallerId === playerId;
  const lockLeft = Math.max(0, lockedUntil - now);
  const iFound = playerId ? room.foundBy.includes(playerId) : false;
  const hunterCount = room.players.filter(
    (p) => p.connected && !p.left && p.id !== room.currentCallerId,
  ).length;

  if (room.phase === 'hunting' && room.calledValue !== null) {
    return (
      <div
        data-tour="status"
        className={cn(
          'card-shadow flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 bg-card px-3.5 py-2.5 transition-colors duration-300 sm:gap-4 sm:px-5 sm:py-3',
          lockLeft > 0 ? 'border-destructive' : 'border-primary',
        )}
      >
        <span className="flex items-center gap-2 text-xs font-extrabold tracking-[0.15em] text-muted-foreground uppercase">
          <FontAwesomeIcon icon={iconHunt} />
          find
        </span>

        <span
          key={room.calledValue}
          className="animate-slam text-4xl leading-none font-extrabold text-primary tnum sm:text-5xl"
        >
          {room.calledValue}
        </span>

        {lockLeft > 0 ? (
          <span className="flex items-center gap-2 rounded-full bg-tint-danger px-3 py-1 text-sm font-bold text-destructive">
            <FontAwesomeIcon icon={iconWrong} />
            locked {Math.ceil(lockLeft / 1000)}s
          </span>
        ) : iFound ? (
          <span className="flex items-center gap-2 rounded-full bg-tint-success px-3 py-1 text-sm font-bold text-success">
            <FontAwesomeIcon icon={iconFound} />
            you found it
          </span>
        ) : (
          <span className="ml-auto text-sm font-bold text-muted-foreground tnum sm:text-base">
            {formatClock(phaseLeftMs)} · {room.foundBy.length}/{hunterCount} found
          </span>
        )}
      </div>
    );
  }

  // The caller, choosing a number.
  return (
    <div
      data-tour="status"
      className={cn(
        'card-shadow relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border-2 bg-card px-3.5 py-2.5 sm:px-5 sm:py-3',
        isCaller ? 'sweep border-primary' : 'border-border',
      )}
    >
      <FontAwesomeIcon
        icon={iconPick}
        className="animate-flash text-base text-primary sm:text-lg"
      />
      <span className="text-sm font-extrabold text-primary sm:text-base">
        Your turn — pick a number and say it out loud
      </span>
      <span className="ml-auto shrink-0 rounded-full bg-surface px-3 py-1 text-sm font-extrabold text-primary tnum sm:text-base">
        {formatClock(phaseLeftMs)}
      </span>
    </div>
  );
}
