import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn } from 'cn';
import { iconCall, iconFound, iconHunt, iconPick, iconWrong } from '@/icons';
import { useStore } from '../store.js';
import { formatClock, useNow } from '../hooks.js';

/** The band above the board: what's happening right now, and what to look for. */
export default function StatusStrip() {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const lockedUntil = useStore((s) => s.lockedUntil);
  // Only runs while there is a lockout counting down; idle the rest of the time.
  const now = useNow(500, lockedUntil > Date.now());

  const caller = room.players.find((p) => p.id === room.currentCallerId);
  const isCaller = room.currentCallerId === playerId;
  const lockLeft = Math.max(0, lockedUntil - now);
  const iFound = playerId ? room.foundBy.includes(playerId) : false;
  const hunterCount = room.players.filter(
    (p) => p.connected && !p.left && p.id !== room.currentCallerId,
  ).length;

  if (room.phase === 'hunting' && room.calledValue !== null) {
    return (
      <div
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-3 py-1.5 transition-colors duration-300 sm:gap-4 sm:px-4 sm:py-2',
          lockLeft > 0 ? 'border-destructive' : 'border-primary/60',
        )}
      >
        <span className="flex items-center gap-2 text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
          <FontAwesomeIcon icon={iconHunt} />
          find
        </span>
        <span
          key={room.calledValue}
          className="animate-slam text-2xl leading-none font-extrabold text-primary tnum sm:text-3xl"
        >
          {room.calledValue}
        </span>

        {lockLeft > 0 ? (
          <span className="flex items-center gap-2 text-sm text-destructive">
            <FontAwesomeIcon icon={iconWrong} />
            locked {Math.ceil(lockLeft / 1000)}s — wrong number
          </span>
        ) : iFound ? (
          <span className="flex items-center gap-2 text-sm text-success">
            <FontAwesomeIcon icon={iconFound} />
            you found it
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tnum sm:text-sm">
            {formatClock(phaseLeftMs)} left · {room.foundBy.length}/{hunterCount} found
          </span>
        )}
      </div>
    );
  }

  // Waiting on a call.
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-xl border bg-card px-3 py-2 transition-colors duration-300 sm:gap-3 sm:px-4 sm:py-2.5',
        isCaller ? 'sweep border-primary/60' : 'border-border',
      )}
    >
      <FontAwesomeIcon
        icon={isCaller ? iconPick : iconCall}
        className={cn('text-sm', isCaller ? 'animate-flash text-primary' : 'text-muted-foreground')}
      />
      {isCaller ? (
        <>
          <span className="text-xs font-semibold text-primary sm:text-sm">
            Your turn — pick a number and say it out loud
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tnum sm:text-sm">
            {formatClock(phaseLeftMs)}
          </span>
        </>
      ) : (
        <>
          <span className="truncate text-xs text-muted-foreground sm:text-sm">
            {caller ? `${caller.name} is choosing a number…` : 'Waiting for the next caller…'}
          </span>
          <span className="ml-auto hidden shrink-0 text-sm text-muted-foreground/60 md:inline">
            scan the board while you wait
          </span>
        </>
      )}
    </div>
  );
}
