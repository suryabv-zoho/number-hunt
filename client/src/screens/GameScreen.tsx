import type { ReactElement } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { iconCall, iconFound, iconHourglass, iconWaiting } from '@/icons';
import { useStore } from '../store.js';
import { clickBoard } from '../socket.js';
import { formatClock, usePassed } from '../hooks.js';
import HUD from '../components/HUD.js';
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
    main = (
      <Notice
        icon={iconHourglass}
        title="Match over"
        body={
          room.solving.length > 0
            ? `Waiting on ${room.solving.length} last puzzle${room.solving.length > 1 ? 's' : ''}…`
            : 'Tallying the scores…'
        }
        sub={formatClock(phaseLeftMs)}
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
  } else {
    // Both phases put you in front of the board: the caller to choose a number,
    // everyone else to hunt the one that was called.
    const mode: BoardMode =
      room.phase === 'await_call' ? (isCaller ? 'pick' : 'idle') : 'hunt';
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
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-2.5 sm:p-3">{main}</main>
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
    <div className="animate-pop flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-5 text-center sm:p-6">
      <FontAwesomeIcon icon={icon} className="mb-1 text-2xl text-primary sm:text-3xl" />
      <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
      <p className="max-w-[28rem] text-sm text-muted-foreground sm:text-base">{body}</p>
      {sub && <div className="font-bold text-primary tnum">{sub}</div>}
    </div>
  );
}
