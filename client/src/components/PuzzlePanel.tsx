import { memo, useEffect, useMemo, useState } from 'react';
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

const SortableTile = memo(function SortableTile({
  tile,
  correct,
}: {
  tile: Tile;
  correct: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.id });

  return (
    <button
      ref={setNodeRef}
      style={{
        // Translate, not Transform: the latter also applies dnd-kit's scaleX/scaleY,
        // which fought the scale we add while dragging and made the tile wobble.
        transform: CSS.Translate.toString(transform),
        // dnd-kit owns the transform transition — it supplies one for tiles sliding out
        // of the way and none for the tile under your finger. A CSS transition on
        // transform from a utility class would ease every pointer move, so the tile
        // perpetually chases the cursor instead of tracking it. That was the jitter.
        transition,
        willChange: isDragging ? 'transform' : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        'grid size-14 touch-none place-items-center rounded-[1.1rem] border-2 text-2xl font-extrabold select-none',
        'cursor-grab shadow-sm transition-[color,background-color,border-color,box-shadow] duration-150 active:cursor-grabbing',
        'xs:size-16 xs:text-[1.6rem] sm:size-[4.5rem] sm:text-[1.9rem]',
        correct
          ? 'border-success bg-tint-success text-success'
          : 'border-border bg-surface-2 text-foreground hover:border-primary',
        isDragging && 'border-primary shadow-xl',
      )}
      {...attributes}
      {...listeners}
    >
      {tile.ch}
    </button>
  );
});

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
    // No hold delay: the tiles aren't scrollable, so a touch can begin a drag at once.
    // Waiting 90ms first is what made dragging feel like it wasn't responding.
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const solved = tiles.map((t) => t.ch).join('') === puzzle.target;
  const itemIds = useMemo(() => tiles.map((t) => t.id), [tiles]);

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
    <div
      data-tour="puzzle"
      className="card-shadow flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto rounded-xl border border-border bg-card p-5 text-center sm:gap-6 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        <FontAwesomeIcon icon={iconPuzzle} className="text-primary" />
        <h2 className="text-lg font-extrabold sm:text-xl">Match the pattern</h2>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-bold transition-colors duration-500',
            decaying ? 'bg-tint-success text-success' : 'bg-surface text-muted-foreground',
          )}
        >
          worth <b className="tnum">+{potential}</b>
        </span>
        {streak > 0 && (
          <span className="animate-pop rounded-full bg-tint-warning px-3 py-1 text-sm font-bold text-warning">
            <b className="tnum">{streak}</b> solved this turn
          </span>
        )}
      </div>

      <div
        style={{ ['--tiles' as string]: puzzle.target.length }}
        className="grid grid-cols-[repeat(4,max-content)] justify-center gap-2.5 sm:grid-cols-[repeat(var(--tiles),max-content)] sm:gap-3"
      >
        {puzzle.target.split('').map((ch, i) => (
          <span
            key={i}
            className="grid size-14 place-items-center rounded-[1.1rem] border-2 border-dashed border-primary/35 bg-surface text-2xl font-extrabold text-primary xs:size-16 xs:text-[1.6rem] sm:size-[4.5rem] sm:text-[1.9rem]"
          >
            {ch}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
        <FontAwesomeIcon icon={iconDrag} />
        drag the tiles below to match
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {/* Rect rather than horizontal-list: on a phone eight tiles wrap onto two rows. */}
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          <div
            style={{ ['--tiles' as string]: tiles.length }}
            className={cn(
              'grid grid-cols-[repeat(4,max-content)] justify-center gap-2.5',
              'sm:grid-cols-[repeat(var(--tiles),max-content)] sm:gap-3',
              shake && 'animate-shake',
            )}
          >
            {tiles.map((t, i) => (
              <SortableTile key={t.id} tile={t} correct={t.ch === puzzle.target[i]} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        onClick={check}
        className={cn(
          'h-12 w-full max-w-[20rem] text-base font-extrabold transition-colors',
          solved && 'bg-success text-on-solid hover:bg-success/90',
        )}
      >
        {solved && <FontAwesomeIcon icon={iconFound} />}
        {solved ? 'Submit' : 'Check'}
      </Button>
      <p className="max-w-[26rem] text-sm text-muted-foreground">
        Solve it and another one appears straight away — keep going until the next player
        takes their turn.
      </p>
    </div>
  );
}
