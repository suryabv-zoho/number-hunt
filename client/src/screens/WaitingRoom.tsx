import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { iconClose, iconWaiting } from '@/icons';
import { useStore } from '../store.js';
import { stopWaiting } from '../socket.js';

/**
 * What the player sees between knocking and being let in.
 *
 * Deliberately sparse: they are not in the room yet, so they get no player list, no
 * settings and no board. All they need is confirmation that the request went somewhere
 * and a way out if nobody answers.
 */
export default function WaitingRoom() {
  const waiting = useStore((s) => s.waitingFor)!;
  const connected = useStore((s) => s.connected);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-5">
      <Card className="card-shadow animate-rise my-auto w-full max-w-[26rem] rounded-xl border-border bg-card">
        <CardContent className="space-y-5 pt-1 text-center">
          <div className="animate-breathe mx-auto grid size-20 place-items-center rounded-full bg-surface">
            <FontAwesomeIcon icon={iconWaiting} className="text-3xl text-primary" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold sm:text-3xl">Waiting to be let in</h1>
            <p className="text-base text-muted-foreground">
              You asked to join room{' '}
              <b className="tracking-[0.2em] text-primary">{waiting.code}</b> as{' '}
              <b className="text-foreground">{waiting.name}</b>. The host has to accept
              before you can play.
            </p>
          </div>

          <p className="rounded-lg bg-surface px-3.5 py-2.5 text-sm text-muted-foreground">
            Keep this open — you'll drop straight into the room the moment they do.
          </p>

          {!connected && (
            <p className="text-sm font-bold text-warning">
              Lost the connection — trying to get back.
            </p>
          )}

          <Button
            variant="secondary"
            className="h-12 w-full text-base font-extrabold"
            onClick={stopWaiting}
          >
            <FontAwesomeIcon icon={iconClose} />
            Stop waiting
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
