import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RoomConfig } from '@game/shared';
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
  iconClose,
  iconCopy,
  iconHost,
  iconLeave,
  iconPlayers,
  iconSettings,
  iconStart,
} from '@/icons';
import { useStore } from '../store.js';
import { closeRoom, leaveRoom, sendConfig, startMatch } from '../socket.js';

export default function LobbyScreen() {
  const room = useStore((s) => s.room)!;
  const playerId = useStore((s) => s.playerId);
  const [copied, setCopied] = useState(false);

  const isHost = room.players.find((p) => p.id === playerId)?.isHost ?? false;
  const ready = room.players.filter((p) => p.connected).length >= 2;

  // Send just the delta; the server merges it. Sending a whole snapshot would let
  // two quick changes race, with the slower one reverting the faster one.
  const patch = (p: Partial<RoomConfig>) => sendConfig(p);

  function copyCode() {
    navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-5">
      <Card className="animate-rise my-auto w-full max-w-[34rem] border-border bg-card">
        <CardContent className="space-y-5 pt-1 sm:space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs tracking-widest text-muted-foreground uppercase">
                Room code
              </div>
              <button
                onClick={copyCode}
                className="group flex items-center gap-2 text-[1.9rem] leading-none font-extrabold tracking-[0.25em] text-primary transition-opacity hover:opacity-80 sm:gap-3 sm:text-[2.4rem] sm:tracking-[0.3em]"
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

          <Separator />

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <FontAwesomeIcon icon={iconPlayers} />
              Players ({room.players.length})
            </h3>
            <ul className="max-h-[30vh] space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {room.players.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-opacity ${
                    p.connected ? '' : 'opacity-50'
                  }`}
                >
                  <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-xs text-muted-foreground tnum">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {p.name}
                    {p.id === playerId && (
                      <span className="ml-1.5 font-normal text-muted-foreground">(you)</span>
                    )}
                  </span>
                  {p.isHost && (
                    <Badge className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/15">
                      <FontAwesomeIcon icon={iconHost} className="text-[0.65rem]" />
                      Host
                    </Badge>
                  )}
                  {!p.connected && <Badge variant="secondary">Away</Badge>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Turn order follows this list, top to bottom. Once the match starts, nobody
              new can join.
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
                  <span className="text-muted-foreground">Numbers on the board</span>
                  <span className="font-semibold text-primary tnum">
                    {room.config.numberCount}
                  </span>
                </div>
                <Slider
                  min={20}
                  max={150}
                  step={5}
                  value={[room.config.numberCount]}
                  onValueChange={([v]: number[]) => patch({ numberCount: v })}
                />
              </div>

              <ConfigRow label="Match length">
                <Select
                  value={String(room.config.matchMinutes)}
                  onValueChange={(v: string) => patch({ matchMinutes: Number(v) })}
                >
                  <SelectTrigger className="w-full sm:w-[11rem]">
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
                  value={String(room.config.findSeconds)}
                  onValueChange={(v: string) => patch({ findSeconds: Number(v) })}
                >
                  <SelectTrigger className="w-full sm:w-[11rem]">
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
                  value={String(room.config.puzzleLength)}
                  onValueChange={(v: string) => patch({ puzzleLength: Number(v) })}
                >
                  <SelectTrigger className="w-full sm:w-[11rem]">
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
                  value={room.config.puzzleCharset}
                  onValueChange={(v: string) =>
                    patch({ puzzleCharset: v as RoomConfig['puzzleCharset'] })
                  }
                >
                  <SelectTrigger className="w-full sm:w-[11rem]">
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
              className="h-11 w-full text-base font-semibold"
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
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
