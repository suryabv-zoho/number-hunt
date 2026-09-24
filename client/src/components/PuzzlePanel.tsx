import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  PUZZLE_BASE_POINTS,
  PUZZLE_BONUS_STEP_MS,
  PUZZLE_MAX_BONUS,
} from '@game/shared';
import type { Tile } from '@game/shared';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';
import { iconDrag, iconFound, iconPuzzle } from '@/icons';
import { useStore } from '../store.js';
import { submitPuzzle } from '../socket.js';
import { useNow } from '../hooks.js';

function SortableTile({ tile, correct }: { tile: Tile; correct: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.id });

  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'grid h-12 w-9 touch-none place-items-center rounded-lg border-2 text-lg font-extrabold select-none',
        'cursor-grab transition-colors duration-200 active:cursor-grabbing',
        'xs:h-14 xs:w-11 xs:text-xl sm:h-[4.5rem] sm:w-16 sm:rounded-xl sm:text-[1.75rem]',
        correct
          ? 'border-success bg-success/10 text-success'
          : 'border-border bg-surface-2 text-foreground hover:border-input',
        isDragging && 'z-10 scale-105 shadow-2xl shadow-black/50',
      )}
      {...attributes}
      {...listeners}
    >
      {tile.ch}
    </button>
  );
}

export default function PuzzlePanel() {
  const puzzle = useStore((s) => s.puzzle)!;
  const streak = useStore((s) => s.streak);
  const [tiles, setTiles] = useState<Tile[]>(puzzle.tiles);
  const [shake, setShake] = useState(false);
  const now = useNow(1000);

  // A new puzzle means a fresh arrangement.
  useEffect(() => setTiles(puzzle.tiles), [puzzle.id, puzzle.tiles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 90, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const solved = tiles.map((t) => t.ch).join('') === puzzle.target;

  const potential = useMemo(() => {
    const lost = Math.floor(Math.max(0, now - puzzle.startedAt) / PUZZLE_BONUS_STEP_MS);
    return PUZZLE_BASE_POINTS + Math.max(0, PUZZLE_MAX_BONUS - lost);
  }, [now, puzzle.startedAt]);

  const decaying = potential > PUZZLE_BASE_POINTS;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = tiles.findIndex((t) => t.id === active.id);
    const to = tiles.findIndex((t) => t.id === over.id);
    const next = arrayMove(tiles, from, to);
    setTiles(next);
    // Auto-submit the moment it matches — this is a speed game, no extra click needed.
    if (next.map((t) => t.ch).join('') === puzzle.target) {
      submitPuzzle(puzzle.id, next.map((t) => t.id));
    }
  }

  function check() {
    if (solved) {
      submitPuzzle(
        puzzle.id,
        tiles.map((t) => t.id),
      );
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto rounded-xl border border-border bg-card p-4 text-center sm:gap-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        <FontAwesomeIcon icon={iconPuzzle} className="text-primary" />
        <h2 className="text-base font-semibold sm:text-lg">Match the pattern</h2>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-500',
            decaying
              ? 'border-success/40 text-success'
              : 'border-border text-muted-foreground',
          )}
        >
          worth <b className="tnum">+{potential}</b>
        </span>
        {streak > 0 && (
          <span className="animate-pop rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
            <b className="tnum">{streak}</b> solved this turn
          </span>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
        {puzzle.target.split('').map((ch, i) => (
          <span
            key={i}
            className="grid h-12 w-9 place-items-center rounded-lg border-2 border-dashed border-border bg-surface text-lg font-extrabold text-primary xs:h-14 xs:w-11 xs:text-xl sm:h-[4.5rem] sm:w-16 sm:rounded-xl sm:text-[1.75rem]"
          >
            {ch}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FontAwesomeIcon icon={iconDrag} />
        drag the tiles below to match
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {/* Rect rather than horizontal-list: on a phone eight tiles wrap onto two rows. */}
        <SortableContext items={tiles.map((t) => t.id)} strategy={rectSortingStrategy}>
          <div className={cn('flex flex-wrap justify-center gap-1.5 sm:gap-2', shake && 'animate-shake')}>
            {tiles.map((t, i) => (
              <SortableTile key={t.id} tile={t} correct={t.ch === puzzle.target[i]} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        onClick={check}
        className={cn(
          'h-11 w-full max-w-[20rem] text-base font-semibold transition-colors',
          solved && 'bg-success text-primary-foreground hover:bg-success/90',
        )}
      >
        {solved && <FontAwesomeIcon icon={iconFound} />}
        {solved ? 'Submit' : 'Check'}
      </Button>
      <p className="max-w-[26rem] text-xs text-muted-foreground">
        Solve it and another one appears straight away — keep going until the next player
        takes their turn.
      </p>
    </div>
  );
}
