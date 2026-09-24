import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from 'cn';
import {
  iconAccept,
  iconClock,
  iconClose,
  iconHunt,
  iconLeave,
  iconMedal,
  iconPlayers,
  iconPuzzle,
  iconReplay,
  iconTrophy,
  iconWalkedOut,
  iconWrong,
} from '@/icons';
import { useStore } from '../store.js';
import { acceptRematch, closeRoom, leaveRoom, playAgain } from '../socket.js';

// Gold gets the trophy; silver and bronze get medals.
const PODIUM = [
  { icon: iconTrophy, cls: 'text-[#f4b740]' },
  { icon: iconMedal, cls: 'text-[#c6ccd8]' },
  { icon: iconMedal, cls: 'text-[#cd8c5c]' },
];

const END_TITLE = {
  board_cleared: 'Board cleared',
  time_up: "Time's up",
  not_enough_players: 'Not enough players left',
} as const;

export default function ResultsScreen() {
  const room = useStore((s) => s.room)!;
  const gameOver = useStore((s) => s.gameOver);
  const playerId = useStore((s) => s.playerId);

  const isHost = room.players.find((p) => p.id === playerId)?.isHost ?? false;
  const hostId = room.players.find((p) => p.isHost)?.id;
  const iAccepted = playerId ? room.readyForNext.includes(playerId) : false;

  const rows = gameOver?.leaderboard ?? [];
  // A walk-out shouldn't be crowned, even if their score held up.
  const winner = rows.find((r) => !r.left);
  const reason = gameOver?.reason ?? 'time_up';

  // The host can't drag people into another match single-handedly.
  const canRestart = room.readyForNext.some((id) => id !== hostId);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-5">
      <Card className="animate-rise my-auto w-full max-w-[40rem] border-border bg-card">
        <CardContent className="space-y-4 pt-1 sm:space-y-5">
          <div className="space-y-1.5 text-center">
            <FontAwesomeIcon
              icon={reason === 'board_cleared' ? iconTrophy : iconClock}
              className="text-2xl text-primary sm:text-3xl"
            />
            <h1 className="text-xl font-bold sm:text-2xl">{END_TITLE[reason]}</h1>
            {winner && (
              <p className="text-sm text-muted-foreground sm:text-base">
                <b className="text-foreground">{winner.name}</b> takes it with{' '}
                <b className="text-primary tnum">{winner.score}</b> points
              </p>
            )}
          </div>

          {/* With a big room this list gets long, so it scrolls inside the card. */}
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border [scrollbar-width:thin]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-9">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <HeadIcon icon={iconPuzzle} label="Puzzles solved" />
                  <HeadIcon icon={iconHunt} label="Numbers found" />
                  <HeadIcon icon={iconWrong} label="Wrong clicks" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.playerId}
                    className={cn(
                      r.playerId === playerId && 'bg-primary/5',
                      r.left && 'opacity-60',
                    )}
                  >
                    <TableCell className="tnum">
                      {r.rank <= 3 && !r.left ? (
                        <FontAwesomeIcon
                          icon={PODIUM[r.rank - 1].icon}
                          className={PODIUM[r.rank - 1].cls}
                        />
                      ) : (
                        r.rank
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.name}</span>
                        {r.left && (
                          <Badge
                            variant="secondary"
                            className="gap-1.5 text-[0.65rem] font-normal"
                          >
                            <FontAwesomeIcon icon={iconWalkedOut} />
                            left early
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right text-base font-bold tnum',
                        r.score < 0 ? 'text-destructive' : 'text-primary',
                      )}
                    >
                      {r.score}
                    </TableCell>
                    <TableCell className="hidden text-center text-muted-foreground tnum sm:table-cell">
                      {r.puzzlesSolved}
                    </TableCell>
                    <TableCell className="hidden text-center text-muted-foreground tnum sm:table-cell">
                      {r.numbersFound}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'hidden text-center tnum sm:table-cell',
                        r.wrongClicks > 0 ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {r.wrongClicks}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Another match in this same room needs the room's own people to agree. */}
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <FontAwesomeIcon icon={iconPlayers} />
                Play again in this room?
              </span>
              <span className="text-xs text-muted-foreground tnum">
                {room.readyForNext.length} in
              </span>
            </div>

            {isHost ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="h-10 flex-1 font-semibold"
                    disabled={!canRestart}
                    onClick={playAgain}
                  >
                    <FontAwesomeIcon icon={iconReplay} />
                    {canRestart ? 'Back to lobby' : 'Waiting for someone to accept'}
                  </Button>
                  <Button variant="destructive" className="h-10" onClick={closeRoom}>
                    <FontAwesomeIcon icon={iconClose} />
                    Close room
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only you can restart or close this room, and at least one other player
                  has to accept first. Closing ends it for everybody.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="h-10 flex-1 font-semibold"
                    variant={iAccepted ? 'secondary' : 'default'}
                    onClick={acceptRematch}
                    disabled={iAccepted}
                  >
                    <FontAwesomeIcon icon={iconAccept} />
                    {iAccepted ? "You're in — waiting for the host" : 'Yes, deal me in'}
                  </Button>
                  <Button variant="ghost" className="h-10" onClick={leaveRoom}>
                    <FontAwesomeIcon icon={iconLeave} />
                    Exit room
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Exiting is final — you won't be able to get back into this room.
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HeadIcon({ icon, label }: { icon: typeof iconPuzzle; label: string }) {
  return (
    <TableHead className="hidden text-center sm:table-cell">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block cursor-help">
            <FontAwesomeIcon icon={icon} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TableHead>
  );
}
