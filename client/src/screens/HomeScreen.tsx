import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  iconBack,
  iconBlocked,
  iconCall,
  iconCreate,
  iconFound,
  iconGear,
  iconHunt,
  iconInfo,
  iconJoin,
  iconNext,
  iconPuzzle,
  iconTeach,
  iconWrong,
} from '@/icons';
import SettingsDialog from '@/components/SettingsDialog';
import { useStore } from '../store.js';
import { createRoom, joinRoom, startPractice } from '../socket.js';

const RULES = [
  { icon: iconCall, text: 'On your turn, pick any number on the board and call it out loud.' },
  { icon: iconHunt, text: 'Everyone else hunts for that number in the clutter.' },
  { icon: iconPuzzle, text: "Finding it doesn't score — it unlocks a tile puzzle. Solving that scores." },
  { icon: iconFound, text: 'Solve one and another appears. Keep banking them until the turn moves on.' },
  { icon: iconWrong, text: 'Wrong number costs you 2 and locks your board for a moment.' },
  { icon: iconBlocked, text: 'Sit on your turn without calling and you lose 5; everyone else gains 2.' },
];

/**
 * One decision per screen.
 *
 * Create and Join used to sit on the same card, and people read the code box as
 * something they had to fill in before they could do anything at all. Now the name is
 * asked once, then the three ways in are three separate choices, and the code box only
 * exists once you've said you have a code.
 */
type Step = 'name' | 'mode' | 'code';

export default function HomeScreen() {
  const storedName = useStore((s) => s.name);
  const setIdentity = useStore((s) => s.setIdentity);
  const connected = useStore((s) => s.connected);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(storedName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  // Put the cursor where the player has to type next, so each step is one tap.
  useEffect(() => {
    if (step === 'name') nameRef.current?.focus();
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  /** Every way in lands here: same busy handling, same error handling. */
  async function attempt(run: () => Promise<{ ok: boolean; error?: string; playerId?: string }>) {
    if (!trimmed || busy || !connected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ack = await run();
    setBusy(false);
    if (ack.ok && ack.playerId) setIdentity(ack.playerId, trimmed);
    else setError(ack.error ?? 'Something went wrong');
  }

  const handleCreate = () => attempt(() => createRoom(trimmed));
  const handlePractice = () => attempt(() => startPractice(trimmed));
  const handleJoin = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 4) return;
    return attempt(() => joinRoom(c, trimmed));
  };

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-5">
      <Card className="card-shadow animate-rise my-auto w-full max-w-[26rem] rounded-xl border-border bg-card">
        <CardContent className="space-y-5 pt-1">
          {notice && (
            <div className="animate-pop flex items-start gap-2.5 rounded-lg border border-warning/35 bg-tint-warning px-3.5 py-3 text-sm font-bold text-warning">
              <FontAwesomeIcon icon={iconInfo} className="mt-0.5" />
              <span className="flex-1">{notice}</span>
              <button
                className="text-warning/60 transition-colors hover:text-warning"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-[2rem] leading-none font-extrabold tracking-tight xs:text-4xl sm:text-[2.6rem]">
                Number<span className="text-primary">Hunt</span>
              </h1>
              <p className="mt-2 text-base text-muted-foreground">
                Call a number. Everyone hunts it down. Solve the tile puzzle to score.
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
              className="-mr-2 size-10 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground"
            >
              <FontAwesomeIcon icon={iconGear} />
            </Button>
          </div>

          {/* Keyed so each step plays its own entrance rather than swapping in place. */}
          <div key={step} className="animate-rise space-y-5">
            {step === 'name' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">What should we call you?</Label>
                  <Input
                    id="name"
                    ref={nameRef}
                    style={{ fontSize: 16 }}
                    value={name}
                    maxLength={16}
                    placeholder="e.g. Surya"
                    autoComplete="off"
                    className="h-12 text-base"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && trimmed && go('mode')}
                  />
                </div>
                <Button
                  className="h-13 w-full text-lg font-extrabold"
                  disabled={!trimmed || !connected}
                  onClick={() => go('mode')}
                >
                  Continue
                  <FontAwesomeIcon icon={iconNext} />
                </Button>
              </>
            )}

            {step === 'mode' && (
              <>
                <div className="flex items-center gap-2">
                  <BackButton onClick={() => go('name')} />
                  <p className="text-base font-bold">
                    Hi, <span className="text-primary">{trimmed}</span>
                  </p>
                </div>

                {/* First and loudest: most people arriving here have never played. */}
                <button
                  type="button"
                  onClick={handlePractice}
                  disabled={busy || !connected}
                  className="group w-full rounded-xl border-2 border-primary bg-surface p-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <span className="flex items-center gap-2.5 text-base font-extrabold text-primary">
                    <FontAwesomeIcon icon={iconTeach} />
                    Practice match
                    <FontAwesomeIcon
                      icon={iconNext}
                      className="ml-auto transition-transform duration-200 group-hover:translate-x-1"
                    />
                  </span>
                  <span className="mt-1.5 block text-sm text-muted-foreground">
                    New here? Play on your own against two computer players. I'll explain
                    every part of the screen and tell you what to do, step by step.
                  </span>
                </button>

                <div className="space-y-2.5">
                  <Button
                    className="h-13 w-full text-lg font-extrabold"
                    disabled={busy || !connected}
                    onClick={handleCreate}
                  >
                    <FontAwesomeIcon icon={iconCreate} />
                    Create a room
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-13 w-full text-lg font-extrabold"
                    disabled={busy || !connected}
                    onClick={() => go('code')}
                  >
                    <FontAwesomeIcon icon={iconJoin} />
                    Join with a code
                  </Button>
                </div>
              </>
            )}

            {step === 'code' && (
              <>
                <div className="flex items-center gap-2">
                  <BackButton onClick={() => go('mode')} />
                  <p className="text-base font-bold">Join a room</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="code">Room code</Label>
                  <Input
                    id="code"
                    ref={codeRef}
                    value={code}
                    maxLength={4}
                    placeholder="CODE"
                    autoComplete="off"
                    style={{ fontSize: 18 }}
                    className="h-14 text-center text-2xl font-extrabold tracking-[0.35em] uppercase"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  />
                  <p className="text-sm text-muted-foreground">
                    Four characters, from whoever created the room.
                  </p>
                </div>

                <Button
                  className="h-13 w-full text-lg font-extrabold"
                  disabled={code.trim().length < 4 || busy || !connected}
                  onClick={handleJoin}
                >
                  Join room
                  <FontAwesomeIcon icon={iconNext} />
                </Button>
              </>
            )}
          </div>

          {error && (
            <p className="animate-rise flex items-center gap-2 rounded-lg bg-tint-danger px-3 py-2 text-sm font-bold text-destructive">
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
              className="flex items-center gap-2 text-base font-bold text-muted-foreground transition-colors hover:text-foreground"
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
                  <li key={i} className="flex gap-3 text-[0.95rem] text-muted-foreground">
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

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-label="Back"
      className="size-10 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground"
    >
      <FontAwesomeIcon icon={iconBack} />
    </Button>
  );
}
