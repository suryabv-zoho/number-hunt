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
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-2.5 py-2 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-[0.2em] text-primary sm:text-base">
            {room.code}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            round {room.roundNumber}
          </span>
        </div>

        <div className="flex gap-1.5">
          <Clock label="match" value={formatClock(matchLeftMs)} />
          {phaseLabel && (
            <Clock label={phaseLabel} value={formatClock(phaseLeftMs)} urgent={urgent} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleSpeak}
                className={cn(speak && speechBlocked && 'text-warning')}
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
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmLeave(true)}
              >
                <FontAwesomeIcon icon={iconLeave} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Leave the match</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* A room can hold a lot of people, so the scoreboard scrolls rather than wraps
          the rest of the HUD off the screen. */}
      <div className="-mx-2.5 flex gap-1.5 overflow-x-auto px-2.5 pb-0.5 sm:-mx-4 sm:px-4 [scrollbar-width:thin]">
        {ranked.map((p) => {
          const isCaller = p.id === room.currentCallerId;
          const isSolving = room.solving.includes(p.id);
          const hasFound = room.foundBy.includes(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-300 sm:text-sm',
                'border-border bg-surface',
                p.id === playerId && 'border-primary/70',
                isCaller && 'border-primary bg-primary/10',
                !p.connected && 'opacity-45',
              )}
            >
              <span className="max-w-[5rem] truncate sm:max-w-[7rem]">{p.name}</span>
              <span
                className={cn(
                  'font-bold tnum',
                  p.score < 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {p.score}
              </span>
              {isCaller ? (
                <FontAwesomeIcon icon={iconCall} className="text-[0.7rem] text-primary" />
              ) : isSolving ? (
                <FontAwesomeIcon icon={iconPuzzle} className="text-[0.7rem] text-info" />
              ) : hasFound ? (
                <FontAwesomeIcon icon={iconFound} className="text-[0.7rem] text-success" />
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
        'flex min-w-[3.6rem] flex-col items-center rounded-lg border bg-surface px-2 py-0.5 transition-colors duration-300 sm:min-w-[4.2rem] sm:px-2.5',
        urgent ? 'border-destructive' : 'border-border',
      )}
    >
      <span className="text-[0.55rem] tracking-widest text-muted-foreground uppercase sm:text-[0.6rem]">
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-bold tnum sm:text-base',
          urgent ? 'animate-flash text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}
