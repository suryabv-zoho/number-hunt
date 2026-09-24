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
  iconBot,
  iconCall,
  iconFound,
  iconLeave,
  iconPuzzle,
  iconSoundOff,
  iconSoundOn,
  iconTeach,
  iconPaused,
} from '@/icons';
import { useStore } from '../store.js';
import { useCoach } from '../coach.js';
import { leaveRoom } from '../socket.js';
import { formatClock } from '../hooks.js';

export default function HUD() {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const matchLeftMs = useStore((s) => s.matchLeftMs);
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const speak = useStore((s) => s.speak);
  const speechBlocked = useStore((s) => s.speechBlocked);
  const paused = useStore((s) => s.paused);
  const toggleSpeak = useStore((s) => s.toggleSpeak);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const coachRunning = useCoach((s) => s.running);
  const coachMinimised = useCoach((s) => s.minimised);
  const setCoachMinimised = useCoach((s) => s.setMinimised);

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
    <header
      data-tour="hud"
      className="brand-bar flex shrink-0 flex-col gap-2.5 px-3 py-2.5 text-white sm:px-5 sm:py-3"
    >
      <div className="flex items-center gap-2 sm:gap-5">
        <div className="flex min-w-0 items-baseline gap-2">
          {/* A practice code is no use to anyone — nobody else can join it. */}
          {room.practice ? (
            <span className="flex items-center gap-1.5 text-base font-extrabold tracking-[0.1em] sm:text-lg">
              <FontAwesomeIcon icon={iconTeach} className="text-sm" />
              {/* The word is the first thing to go when the row runs out of room. */}
              <span className="hidden xs:inline">PRACTICE</span>
            </span>
          ) : (
            <span className="truncate text-base font-extrabold tracking-[0.15em] sm:text-lg">
              {room.code}
            </span>
          )}
          <span className="hidden text-sm text-white/70 sm:inline">
            round {room.roundNumber}
          </span>
        </div>

        <div className="flex shrink-0 gap-1.5 sm:gap-2">
          <Clock label={paused ? 'held' : 'match'} value={formatClock(matchLeftMs)} paused={paused} />
          {phaseLabel && (
            <Clock
              label={phaseLabel}
              value={formatClock(phaseLeftMs)}
              urgent={urgent && !paused}
              paused={paused}
            />
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {/* The tour's home. Floating it over the game meant covering the very thing
              it describes, so it lives up here where nothing else ever sits. */}
          {coachRunning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={() => setCoachMinimised(!coachMinimised)}
                  aria-label={
                    coachMinimised ? 'Show the instructions' : 'Hide the instructions'
                  }
                  className="relative size-10 rounded-full p-0 text-white hover:bg-white/15 hover:text-white"
                >
                  <FontAwesomeIcon icon={iconTeach} />
                  {coachMinimised && (
                    <span className="animate-flash absolute top-1.5 right-1.5 size-2 rounded-full bg-accent-500" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {coachMinimised ? 'Show the instructions' : 'Hide the instructions'}
              </TooltipContent>
            </Tooltip>
          )}

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
                data-tour="leave"
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
              {p.isBot && <FontAwesomeIcon icon={iconBot} className="text-xs opacity-70" />}
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
  paused,
}: {
  label: string;
  value: string;
  urgent?: boolean;
  paused?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-[3.6rem] flex-col items-center rounded-lg px-2 py-1 transition-colors duration-300 sm:min-w-[5rem] sm:px-2.5',
        urgent ? 'bg-destructive' : 'bg-white/15',
        // A clock that has stopped for no visible reason reads as a bug, so it says so.
        paused && 'bg-white/10 opacity-70',
      )}
    >
      <span className="flex items-center gap-1 text-[0.65rem] font-bold tracking-widest text-white/75 uppercase sm:text-xs">
        {paused && <FontAwesomeIcon icon={iconPaused} className="text-[0.6rem]" />}
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
