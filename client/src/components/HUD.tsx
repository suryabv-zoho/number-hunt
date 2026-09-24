import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from 'cn';
import {
  iconCall,
  iconFound,
  iconLeave,
  iconPuzzle,
  iconSoundOff,
  iconSoundOn,
} from '@/icons';
import { useStore } from '../store.js';
import { leaveRoom } from '../socket.js';
import { formatClock } from '../hooks.js';

export default function HUD() {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const matchLeftMs = useStore((s) => s.matchLeftMs);
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const speak = useStore((s) => s.speak);
  const speechBlocked = useStore((s) => s.speechBlocked);
  const toggleSpeak = useStore((s) => s.toggleSpeak);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const phaseLabel =
    room.phase === 'await_call'
      ? 'calling'
      : room.phase === 'hunting'
        ? 'find it'
        : room.phase === 'wrapup'
          ? 'last puzzles'
          : '';

  const urgent = phaseLeftMs !== null && phaseLeftMs <= 10_000;
  const ranked = [...room.players]
    .filter((p) => !p.left)
    .sort((a, b) => b.score - a.score);

  return (
    <header className="brand-bar flex shrink-0 flex-col gap-2.5 px-3 py-2.5 text-white sm:px-5 sm:py-3">
      <div className="flex items-center gap-3 sm:gap-5">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-extrabold tracking-[0.15em] sm:text-lg">
            {room.code}
          </span>
          <span className="hidden text-sm text-white/70 sm:inline">
            round {room.roundNumber}
          </span>
        </div>

        <div className="flex gap-2">
          <Clock label="match" value={formatClock(matchLeftMs)} />
          {phaseLabel && (
            <Clock label={phaseLabel} value={formatClock(phaseLeftMs)} urgent={urgent} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={toggleSpeak}
                aria-label="Read called numbers aloud"
                className={cn(
                  'size-10 rounded-full p-0 text-white hover:bg-white/15 hover:text-white',
                  speak && speechBlocked && 'text-warning',
                )}
              >
                <FontAwesomeIcon icon={speak ? iconSoundOn : iconSoundOff} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {speak && speechBlocked
                ? "Your browser blocked the read-aloud — you'll still hear the chime"
                : 'Read called numbers aloud'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={() => setConfirmLeave(true)}
                aria-label="Leave the match"
                className="size-10 rounded-full p-0 text-white hover:bg-white/15 hover:text-white"
              >
                <FontAwesomeIcon icon={iconLeave} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Leave the match</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* A room can hold a lot of people, so the scoreboard scrolls rather than pushing
          the rest of the HUD off the screen. */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-5 sm:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ranked.map((p) => {
          const isCaller = p.id === room.currentCallerId;
          const isSolving = room.solving.includes(p.id);
          const hasFound = room.foundBy.includes(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-all duration-300 sm:text-base',
                isCaller
                  ? 'bg-accent-500 text-brand-900'
                  : p.id === playerId
                    ? 'bg-brand-100 text-foreground'
                    : 'bg-white/10 text-foreground',
                !p.connected && 'opacity-50',
              )}
            >
              <span className="max-w-[6rem] truncate sm:max-w-[8rem]">{p.name}</span>
              <span
                className={cn(
                  'font-extrabold tnum',
                  p.score < 0 ? (isCaller ? 'text-[#a8123f]' : 'text-destructive') : '',
                )}
              >
                {p.score}
              </span>
              {isCaller ? (
                <FontAwesomeIcon icon={iconCall} className="text-xs" />
              ) : isSolving ? (
                <FontAwesomeIcon icon={iconPuzzle} className="text-xs opacity-80" />
              ) : hasFound ? (
                <FontAwesomeIcon icon={iconFound} className="text-xs opacity-80" />
              ) : null}
            </div>
          );
        })}
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[26rem]">
          <DialogHeader>
            <DialogTitle>Leave this match?</DialogTitle>
            <DialogDescription>
              This is final — you won't be able to rejoin this room. Your score stays on
              the final leaderboard, marked as having left early.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button variant="destructive" onClick={leaveRoom}>
              <FontAwesomeIcon icon={iconLeave} />
              Leave match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

function Clock({
  label,
  value,
  urgent,
}: {
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-[4.2rem] flex-col items-center rounded-lg px-2.5 py-1 transition-colors duration-300 sm:min-w-[5rem]',
        urgent ? 'bg-destructive' : 'bg-white/15',
      )}
    >
      <span className="text-[0.65rem] font-bold tracking-widest text-white/75 uppercase sm:text-xs">
        {label}
      </span>
      <span
        className={cn(
          'text-base font-extrabold text-white tnum sm:text-lg',
          urgent && 'animate-flash',
        )}
      >
        {value}
      </span>
    </div>
  );
}
