import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { BotActivityKind } from '@game/shared';
import { cn } from 'cn';
import {
  iconFound,
  iconHunt,
  iconCall,
  iconPuzzle,
  iconWatch,
  iconWrong,
  iconBlocked,
  iconThinking,
} from '@/icons';
import { useStore } from '../store.js';

/**
 * Practice only. In a real match the other players are on their own phones, so half the
 * game — the part where everyone else is hunting and solving — is invisible to you. Here
 * the server narrates it, which is the fastest way to understand what a turn actually is.
 *
 * On a phone only the newest line shows, because the board needs the height more.
 */
const LOOK: Record<BotActivityKind, { icon: IconDefinition; tone: string }> = {
  thinking: { icon: iconThinking, tone: 'text-muted-foreground' },
  called: { icon: iconCall, tone: 'text-primary' },
  scanning: { icon: iconHunt, tone: 'text-muted-foreground' },
  found: { icon: iconFound, tone: 'text-success' },
  wrong: { icon: iconWrong, tone: 'text-destructive' },
  solved: { icon: iconPuzzle, tone: 'text-warning' },
  gaveup: { icon: iconBlocked, tone: 'text-muted-foreground' },
};

export default function BotFeed() {
  const feed = useStore((s) => s.botFeed);

  return (
    <section
      data-tour="feed"
      className="card-shadow shrink-0 rounded-xl border border-border bg-card px-3.5 py-2.5 sm:px-4 sm:py-3"
    >
      <h2 className="flex items-center gap-2 text-[0.65rem] font-extrabold tracking-[0.15em] text-muted-foreground uppercase">
        <FontAwesomeIcon icon={iconWatch} />
        what the computers are doing
      </h2>

      {feed.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          Nothing yet — this fills up as they take their turns.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {feed.map((item, i) => {
            const look = LOOK[item.kind] ?? LOOK.scanning;
            return (
              <li
                key={item.id}
                className={cn(
                  'flex items-start gap-2.5 text-sm font-bold',
                  look.tone,
                  // Newest first, and the older ones only when there's room for them.
                  i === 0 ? 'animate-rise flex' : 'hidden sm:flex sm:opacity-60',
                )}
              >
                <FontAwesomeIcon icon={look.icon} className="mt-0.5 w-4 shrink-0" />
                <span className="flex-1">{item.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
