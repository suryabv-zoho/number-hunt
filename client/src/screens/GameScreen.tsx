import type { ReactElement } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { iconCall, iconFound, iconHourglass, iconWaiting } from '@/icons';
import { nameList } from '@/lib/utils';
import { useStore } from '../store.js';
import { clickBoard } from '../socket.js';
import { formatClock, usePassed } from '../hooks.js';
import HUD from '../components/HUD.js';
import BotFeed from '../components/BotFeed.js';
import BoardCanvas, { type BoardMode } from '../components/BoardCanvas.js';
import PuzzlePanel from '../components/PuzzlePanel.js';
import StatusStrip from '../components/StatusStrip.js';

export default function GameScreen() {
  const room = useStore((s) => s.room)!;
  const tokens = useStore((s) => s.tokens);
  const playerId = useStore((s) => s.playerId);
  const puzzle = useStore((s) => s.puzzle);
  const lockedUntil = useStore((s) => s.lockedUntil);
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const isCaller = room.currentCallerId === playerId;
  const iFound = playerId ? room.foundBy.includes(playerId) : false;
  // One timer that fires when the lockout expires, rather than polling four times a second.
  const locked = !usePassed(lockedUntil);

  let main: ReactElement;

  if (puzzle) {
    main = <PuzzlePanel />;
  } else if (room.phase === 'wrapup') {
    // Anyone who opened a puzzle before the whistle gets to finish it. This screen is
    // what the people who *weren't* mid-puzzle see, so it has to say whose puzzle we're
    // waiting on and why — otherwise it's a countdown with nothing behind it.
    const finishing = room.players.filter((p) => room.solving.includes(p.id) && !p.left);
    main = (
      <Notice
        icon={iconHourglass}
        title="Match over"
        body={
          finishing.length === 0
            ? 'Adding up the scores…'
            : finishing.length === 1
              ? `${finishing[0].name} opened a puzzle just before the whistle and still has a moment to finish it. If they solve it, those points count.`
              : `${nameList(finishing.map((p) => p.name))} opened puzzles just before the whistle and still have a moment to finish them. Anything they solve still counts.`
        }
        sub={
          finishing.length > 0
            ? `Leaderboard in ${formatClock(phaseLeftMs)}`
            : formatClock(phaseLeftMs)
        }
      />
    );
  } else if (room.phase === 'hunting' && isCaller) {
    main = (
      <Notice
        icon={iconCall}
        title={`You called ${room.calledValue ?? ''}`}
        body={`${room.foundBy.length} player${room.foundBy.length === 1 ? ' has' : 's have'} found it.`}
        sub={`${formatClock(phaseLeftMs)} left in the round`}
      />
    );
  } else if (room.phase === 'hunting' && iFound) {
    main = (
      <Notice
        icon={iconFound}
        title="Nice find"
        body="Your puzzle is done for this round — sit tight for the next call."
        sub={`${formatClock(phaseLeftMs)} left`}
      />
    );
  } else if (room.phase === 'await_call' && !room.currentCallerId) {
    main = (
      <Notice
        icon={iconWaiting}
        title="Paused"
        body="Waiting for players to come back…"
      />
    );
  } else if (room.phase === 'await_call' && !isCaller) {
    // Only the caller needs the board right now. Everyone else gets a proper waiting
    // screen rather than a board they can't act on — it also stops them pre-scanning,
    // so the hunt starts fairly for everybody at the moment the number is called.
    main = <WaitingForCall />;
  } else {
    const mode: BoardMode = room.phase === 'await_call' ? 'pick' : 'hunt';
    main = (
      <>
        <StatusStrip />
        <BoardCanvas
          tokens={tokens}
          reveal={room.lastReveal}
          mode={mode}
          locked={locked}
          onPick={clickBoard}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HUD />
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-2.5 sm:p-3">
        {main}
        {/* Practice only: the other side of the turn, which is invisible in a real match. */}
        {room.practice && <BotFeed />}
      </main>
    </div>
  );
}

/** What everyone but the caller sees while a number is being chosen. */
function WaitingForCall() {
  const room = useStore((s) => s.room)!;
  const phaseLeftMs = useStore((s) => s.phaseLeftMs);
  const caller = room.players.find((p) => p.id === room.currentCallerId);

  return (
    <div className="card-shadow relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-hidden rounded-xl border border-border bg-card p-6 text-center">
      <div className="sweep pointer-events-none absolute inset-0" />

      <div className="animate-breathe grid size-20 place-items-center rounded-full bg-surface sm:size-24">
        <FontAwesomeIcon icon={iconCall} className="text-3xl text-primary sm:text-4xl" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-2xl font-extrabold sm:text-3xl">
          {caller?.name ?? 'Someone'} is choosing
        </h2>
        <p className="text-base text-muted-foreground">
          Get ready — the number lands in a moment.
        </p>
      </div>

      <div className="rounded-full bg-surface px-5 py-2 text-lg font-extrabold text-primary tnum">
        {formatClock(phaseLeftMs)}
      </div>

      {room.lastReveal && (
        <p className="text-sm text-muted-foreground">
          Last round's number was{' '}
          <b className="text-foreground tnum">{room.lastReveal.value}</b>
        </p>
      )}
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
  sub,
}: {
  icon: IconDefinition;
  title: string;
  body: string;
  sub?: string;
}) {
  return (
    <div className="card-shadow animate-pop flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-surface sm:size-24">
        <FontAwesomeIcon icon={icon} className="text-3xl text-primary sm:text-4xl" />
      </div>
      <h2 className="text-2xl font-extrabold sm:text-3xl">{title}</h2>
      <p className="max-w-[28rem] text-base text-muted-foreground">{body}</p>
      {sub && (
        <div className="rounded-full bg-surface px-5 py-2 text-lg font-extrabold text-primary tnum">
          {sub}
        </div>
      )}
    </div>
  );
}
