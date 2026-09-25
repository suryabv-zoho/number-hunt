import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RoomConfig } from '@game/shared';
import {
  MIN_CALLS_PER_PLAYER,
  callsEach,
  roomCapacity,
  roundsInMatch,
} from '@game/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  iconAccept,
  iconClose,
  iconCopy,
  iconGear,
  iconHost,
  iconInfo,
  iconLeave,
  iconPlayers,
  iconSettings,
  iconStart,
  iconWaiting,
  iconWarning,
} from '@/icons';
import { cn } from 'cn';
import SettingsDialog from '@/components/SettingsDialog';
import { useStore } from '../store.js';
import {
  admitPlayer,
  closeRoom,
  declinePlayer,
  kickPlayer,
  leaveRoom,
  sendConfig,
  startMatch,
} from '../socket.js';

export default function LobbyScreen() {
  const [showSettings, setShowSettings] = useState(false);
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const [copied, setCopied] = useState(false);

  // Room size follows the match settings: a match holds a fixed number of rounds, and
  // every extra player divides them further.
  const seats = roomCapacity(room.config);
  const rounds = roundsInMatch(room.config);
  const perHead = Math.max(1, Math.floor(callsEach(room.config, seats)));
  const full = room.players.length >= seats;
  const shortTurns = perHead < MIN_CALLS_PER_PLAYER;

  const isHost = room.players.find((p) => p.id === playerId)?.isHost ?? false;
  const ready = room.players.filter((p) => p.connected).length >= 2;

  // Send just the delta; the server merges it. Sending a whole snapshot would let
  // two quick changes race, with the slower one reverting the faster one.
  //
  // The host guard here is not belt-and-braces: `fieldset[disabled]` only disables real
  // form controls, and a Radix Slider is built from divs, so without this a non-host
  // could drag it and fire a rejected config change on every single tick.
  const patch = (p: Partial<RoomConfig>) => {
    if (!isHost) return;
    sendConfig(p);
  };

  function copyCode() {
    navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-5">
      <Card className="card-shadow animate-rise my-auto w-full max-w-[34rem] rounded-xl border-border bg-card">
        <CardContent className="space-y-5 pt-1 sm:space-y-6">
          <div>
            {/* The code is deliberately huge and letter-spaced, so it gets a line to
                itself. Sharing one with the buttons left ~320px of content fighting over
                327px, and the code lost. The label keeps the button row company. */}
            <div className="flex items-center gap-2">
              <span className="text-xs tracking-widest text-muted-foreground uppercase">
                Room code
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {/* Waiting for people is exactly when someone fiddles with their theme. */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Settings"
                  className="size-9 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSettings(true)}
                >
                  <FontAwesomeIcon icon={iconGear} />
                </Button>

                {/* The room is the host's to shut down; everyone else just walks out. */}
                {isHost ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={closeRoom}
                  >
                    <FontAwesomeIcon icon={iconClose} />
                    Close room
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={leaveRoom}>
                    <FontAwesomeIcon icon={iconLeave} />
                    Leave
                  </Button>
                )}
              </div>
            </div>

            <button
              onClick={copyCode}
              aria-label={`Room code ${room.code.split('').join(' ')}, tap to copy`}
              className="group mt-0.5 flex w-full items-center gap-2 text-[2.2rem] leading-none font-extrabold tracking-[0.25em] text-primary transition-opacity hover:opacity-80 sm:gap-3 sm:text-[2.6rem] sm:tracking-[0.3em]"
            >
              {room.code}
              <FontAwesomeIcon
                icon={iconCopy}
                className="text-base text-muted-foreground transition-colors group-hover:text-foreground"
              />
            </button>

            <div className="h-4 text-xs text-success">
              {copied && <span className="animate-fade">Copied to clipboard</span>}
            </div>
          </div>

          <Separator />

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <FontAwesomeIcon icon={iconPlayers} />
              Players ({room.players.length}/{seats})
            </h3>
            <ul className="max-h-[30vh] space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {room.players.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg bg-surface px-3.5 py-3 transition-opacity ${
                    p.connected ? '' : 'opacity-50'
                  }`}
                >
                  <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-sm font-extrabold text-primary tnum">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-base font-bold">
                    {p.name}
                    {p.id === playerId && (
                      <span className="ml-1.5 font-normal text-muted-foreground">(you)</span>
                    )}
                  </span>
                  {p.isHost && (
                    <Badge className="gap-1.5 bg-warning text-on-solid hover:bg-warning">
                      <FontAwesomeIcon icon={iconHost} className="text-[0.65rem]" />
                      Host
                    </Badge>
                  )}
                  {!p.connected && <Badge variant="secondary">Away</Badge>}
                  {/* The host can clear a seat — but never their own. */}
                  {isHost && p.id !== playerId && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${p.name}`}
                      title={`Remove ${p.name}`}
                      className="size-8 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-tint-danger hover:text-destructive"
                      onClick={() => kickPlayer(p.id)}
                    >
                      <FontAwesomeIcon icon={iconClose} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Turn order follows this list, top to bottom. Once the match starts, nobody
              new can join.
            </p>

            {/* Everyone who has knocked. Only the host can answer, but everyone sees
                the queue — it explains why the room isn't starting yet. */}
            {room.pending.length > 0 && (
              <div className="animate-rise space-y-1.5 rounded-lg border-2 border-primary bg-tint-primary p-3">
                <h4 className="flex items-center gap-2 text-xs font-extrabold tracking-[0.15em] text-primary uppercase">
                  <FontAwesomeIcon icon={iconWaiting} />
                  waiting to join ({room.pending.length})
                </h4>
                <ul className="space-y-1.5">
                  {room.pending.map((req) => (
                    <li
                      key={req.requestId}
                      className="flex items-center gap-2 rounded-lg bg-card px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-base font-bold">
                        {req.name}
                      </span>
                      {isHost ? (
                        <>
                          <Button
                            aria-label={`Let ${req.name} in`}
                            disabled={full}
                            className="h-9 px-3 text-sm font-extrabold"
                            onClick={() => admitPlayer(req.requestId)}
                          >
                            <FontAwesomeIcon icon={iconAccept} />
                            {full ? 'Full' : 'Let in'}
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`Turn ${req.name} away`}
                            className="size-9 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-tint-danger hover:text-destructive"
                            onClick={() => declinePlayer(req.requestId)}
                          >
                            <FontAwesomeIcon icon={iconClose} />
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          waiting for the host
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The cap is a consequence of the settings, not an arbitrary limit, so say
                which setting to move rather than just refusing people at the door. */}
            <p
              className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-bold',
                full ? 'bg-tint-warning text-warning' : 'bg-surface text-muted-foreground',
              )}
            >
              <FontAwesomeIcon icon={full ? iconWarning : iconInfo} className="mt-0.5" />
              <span>
                {full ? 'Room full. ' : ''}
                These settings fit <b className="text-foreground tnum">{rounds}</b> rounds,
                so <b className="text-foreground tnum">{seats}</b>{' '}
                {seats === 1 ? 'player' : 'players'} each get about{' '}
                <b className="text-foreground tnum">{perHead}</b>{' '}
                {perHead === 1 ? 'turn' : 'turns'} to call.
                {shortTurns
                  ? ' A shorter find window or a longer match would give everyone more.'
                  : ''}
              </span>
            </p>
          </section>

          <Separator />

          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <FontAwesomeIcon icon={iconSettings} />
              Match settings
            </h3>

            <fieldset disabled={!isHost} className="space-y-4 disabled:opacity-60">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-base font-bold text-muted-foreground">Numbers on the board</span>
                  <span className="text-lg font-extrabold text-primary tnum">
                    {room.config.numberCount}
                  </span>
                </div>
                <Slider
                  disabled={!isHost}
                  min={20}
                  max={150}
                  step={5}
                  value={[room.config.numberCount]}
                  onValueChange={([v]: number[]) => patch({ numberCount: v })}
                />
              </div>

              <ConfigRow label="Match length">
                <Select
                  disabled={!isHost}
                  value={String(room.config.matchMinutes)}
                  onValueChange={(v: string) => patch({ matchMinutes: Number(v) })}
                >
                  <SelectTrigger className="h-12 w-full text-base sm:w-[12rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 min (test)</SelectItem>
                    <SelectItem value="5">5 min</SelectItem>
                    <SelectItem value="10">10 min</SelectItem>
                    <SelectItem value="15">15 min</SelectItem>
                  </SelectContent>
                </Select>
              </ConfigRow>

              <ConfigRow label="Time to find a number">
                <Select
                  disabled={!isHost}
                  value={String(room.config.findSeconds)}
                  onValueChange={(v: string) => patch({ findSeconds: Number(v) })}
                >
                  <SelectTrigger className="h-12 w-full text-base sm:w-[12rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="45">45 seconds</SelectItem>
                    <SelectItem value="60">60 seconds</SelectItem>
                    <SelectItem value="90">90 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </ConfigRow>

              <ConfigRow label="Puzzle size">
                <Select
                  disabled={!isHost}
                  value={String(room.config.puzzleLength)}
                  onValueChange={(v: string) => patch({ puzzleLength: Number(v) })}
                >
                  <SelectTrigger className="h-12 w-full text-base sm:w-[12rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 tiles</SelectItem>
                    <SelectItem value="6">6 tiles</SelectItem>
                    <SelectItem value="8">8 tiles</SelectItem>
                  </SelectContent>
                </Select>
              </ConfigRow>

              <ConfigRow label="Puzzle characters">
                <Select
                  disabled={!isHost}
                  value={room.config.puzzleCharset}
                  onValueChange={(v: string) =>
                    patch({ puzzleCharset: v as RoomConfig['puzzleCharset'] })
                  }
                >
                  <SelectTrigger className="h-12 w-full text-base sm:w-[12rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alnum">Letters + digits</SelectItem>
                    <SelectItem value="letters">Letters only</SelectItem>
                  </SelectContent>
                </Select>
              </ConfigRow>
            </fieldset>
            {!isHost && (
              <p className="text-xs text-muted-foreground">Only the host can change these.</p>
            )}
          </section>

          {isHost ? (
            <Button
              // The waiting label is long, and the button inherits `whitespace-nowrap`
              // from the shared variant — on a 320px screen it ran past its own edge.
              className="h-auto min-h-13 w-full py-3 text-base font-extrabold whitespace-normal sm:text-lg"
              disabled={!ready}
              onClick={startMatch}
            >
              <FontAwesomeIcon icon={iconStart} />
              {ready ? 'Start match' : 'Waiting for one more player…'}
            </Button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              <span className="animate-flash">Waiting for the host to start…</span>
            </p>
          )}
        </CardContent>
      </Card>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-base font-bold text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
