import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  iconBlocked,
  iconCall,
  iconFound,
  iconHunt,
  iconInfo,
  iconNext,
  iconPuzzle,
  iconWrong,
} from '@/icons';
import { useStore } from '../store.js';
import { createRoom, joinRoom } from '../socket.js';

const RULES = [
  { icon: iconCall, text: 'On your turn, pick any number on the board and call it out loud.' },
  { icon: iconHunt, text: 'Everyone else hunts for that number in the clutter.' },
  { icon: iconPuzzle, text: "Finding it doesn't score — it unlocks a tile puzzle. Solving that scores." },
  { icon: iconFound, text: 'Solve one and another appears. Keep banking them until the turn moves on.' },
  { icon: iconWrong, text: 'Wrong number costs you 2 and locks your board for a moment.' },
  { icon: iconBlocked, text: 'Sit on your turn without calling and you lose 5; everyone else gains 2.' },
];

export default function HomeScreen() {
  const storedName = useStore((s) => s.name);
  const setIdentity = useStore((s) => s.setIdentity);
  const connected = useStore((s) => s.connected);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  const [name, setName] = useState(storedName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const trimmed = name.trim();

  async function handleCreate() {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ack = await createRoom(trimmed);
    setBusy(false);
    if (ack.ok && ack.playerId) setIdentity(ack.playerId, trimmed);
    else setError(ack.error ?? 'Could not create a room');
  }

  async function handleJoin() {
    const c = code.trim().toUpperCase();
    if (!trimmed || c.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ack = await joinRoom(c, trimmed);
    setBusy(false);
    if (ack.ok && ack.playerId) setIdentity(ack.playerId, trimmed);
    else setError(ack.error ?? 'Could not join');
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-5">
      <Card className="animate-rise my-auto w-full max-w-[26rem] border-border bg-card">
        <CardContent className="space-y-5 pt-1">
          {notice && (
            <div className="animate-pop flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              <FontAwesomeIcon icon={iconInfo} className="mt-0.5" />
              <span className="flex-1">{notice}</span>
              <button
                className="text-warning/70 transition-colors hover:text-warning"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          <div>
            <h1 className="text-[2.1rem] leading-none font-extrabold tracking-tight">
              Number<span className="text-primary">Hunt</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Call a number. Everyone hunts it down. Solve the tile puzzle to score.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={name}
              maxLength={16}
              placeholder="e.g. Surya"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          <Button
            className="h-11 w-full text-base font-semibold"
            disabled={!trimmed || busy || !connected}
            onClick={handleCreate}
          >
            Create a room
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs tracking-wide text-muted-foreground uppercase">
              or join one
            </span>
            <Separator className="flex-1" />
          </div>

          <div className="flex gap-2">
            <Input
              value={code}
              maxLength={4}
              placeholder="CODE"
              autoComplete="off"
              className="h-11 text-center text-lg font-bold tracking-[0.4em] uppercase"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <Button
              variant="secondary"
              className="h-11 px-6"
              disabled={!trimmed || code.trim().length < 4 || busy || !connected}
              onClick={handleJoin}
            >
              Join
            </Button>
          </div>

          {error && (
            <p className="animate-rise flex items-center gap-2 text-sm text-destructive">
              <FontAwesomeIcon icon={iconWrong} />
              {error}
            </p>
          )}
          {!connected && (
            <p className="text-sm text-muted-foreground">Connecting to the server…</p>
          )}

          <div>
            <button
              type="button"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowRules((v) => !v)}
            >
              <FontAwesomeIcon
                icon={iconNext}
                className={`transition-transform duration-200 ${showRules ? 'rotate-90' : ''}`}
              />
              How it works
            </button>
            {showRules && (
              <ul className="stagger mt-3 space-y-2.5">
                {RULES.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                    <FontAwesomeIcon
                      icon={r.icon}
                      className="mt-0.5 w-4 shrink-0 text-primary"
                    />
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
