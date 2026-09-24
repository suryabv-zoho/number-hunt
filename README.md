# Number Hunt

A real-time party game for any number of players. Numbers are scattered at random
positions, angles and colours across a shared board. Players take turns calling one out;
everyone else has to find it in the clutter. Finding it doesn't score — it unlocks a tile
puzzle, and **only solving puzzles scores**.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. One player creates a room, everyone else joins with the
4-character code.

## How a round works

1. **Call.** The player whose turn it is looks at the board and **picks a number
   themselves** — hovering highlights it, clicking calls it. They say it out loud, and the
   other screens can read it aloud too. They have 25 seconds; sit on the turn and it is
   burned: **−5 for them, +2 for everyone kept waiting**, and the turn moves on without
   any number leaving the board.
2. **Hunt.** Everyone else gets the find window (60s by default) to click that number on
   the board. Clicking the *wrong* number costs 2 points and locks you out for 2 seconds.
   Clicking empty space is free.
3. **Solve.** The moment you find it, a tile puzzle opens: a target like `a2b3` and the
   same characters scrambled. Drag them into order. The caller gets one too, at the moment
   they call — that's what keeps them from helping. **Solve it and another appears
   immediately**, so finding the number early buys you more time to bank more puzzles.
4. **Score.** A solve is worth 10 points, plus up to 6 more for speed (one point lost per
   5 seconds). Puzzles are the only thing that scores. Totals can and do go negative.

The find window always runs its full length — cutting it short the moment everyone has
found the number would punish exactly the players who were fastest. Then that number
leaves the board and the turn passes.

**Your puzzle stream does not stop there.** It keeps going right up until the next number
is called. The one exception is the player whose turn it now is: their puzzle closes so
they can see the board and choose. That's what makes a 2-player game work — the finder
solves for the whole window, then gets the board back for their turn.

The match ends when the board is cleared, the clock runs out, or the room drops below two
players. Anyone still mid-puzzle gets a 20-second wrapup window to bank it, then the
leaderboard locks.

## Settings (host only, in the lobby)

| Setting | Range | Default |
| --- | --- | --- |
| Numbers on the board | 20–150 | 60 |
| Match length | 1 / 5 / 10 / 15 min | 15 min |
| Time to find a number | 30 / 45 / 60 / 90 s | 60 s |
| Puzzle size | 4 / 6 / 8 tiles | 6 |
| Puzzle characters | letters, or letters + digits | letters + digits |

The 25-second call window, the −5/+2 missed-call scoring and the 20-second wrapup are
fixed constants, all in `shared/src/scoring.ts`.

## Layout

```
shared/   pure game logic shared by both sides — board generation, puzzles, scoring,
          the socket event names and every wire type
server/   express + socket.io. state.ts is the room shape, game.ts is the state machine
          and every timer, handlers.ts wires sockets to it. All state is in memory.
client/   vite + react 19, tailwind v4 and shadcn/ui components, Font Awesome icons.
          The board is a <canvas>; puzzles use dnd-kit.
```

The interface is dark-only by design: charcoal surfaces, hairline borders and a single
amber accent that carries every call to action, with the board palette deliberately held
to one lightness so no number is easier to spot than another. All the colour lives in CSS
variables at the top of `client/src/index.css`.

The server is authoritative for everything that matters: it owns the board, decides whose
turn it is, hit-tests every click against the token geometry, and validates every puzzle
submission. The client only renders and sends intents.

## Performance

The game is built to stay playable on a weak phone and a small server.

- **The board is sent once, not constantly.** It's by far the biggest thing on the wire and
  it only changes by one number a round, so it goes out as `board:init` at the start (and
  on reconnect) and then as `board:remove` deltas. That took the routine broadcast from
  8 KB to 1.2 KB at the default board, and from 18.6 KB to 1.2 KB at 150 numbers — the
  snapshot no longer scales with board size at all.
- **The canvas only draws what's on screen.** Tokens outside the visible rect are culled,
  which matters when zoomed in on a phone (at 3x, 17 of 150 numbers are drawn). Grid lines
  are one path instead of 31 strokes, and the backing store is capped by a pixel budget
  rather than trusting `devicePixelRatio` on a high-density screen.
- **Dragging repaints once per frame.** Pointer events fire far faster than the display
  refreshes, so panning is coalesced into a single `requestAnimationFrame`.
- **No idle timers.** The click lockout uses one timer that fires when it expires instead
  of polling four times a second, and the other clocks only tick while something is
  actually counting down.
- **The vendor bundle is split** from the app code, so a change to the game re-downloads
  ~16 KB rather than the whole 600 KB.

## Sound

Called numbers are read aloud, with a short two-note chime alongside. The chime matters:
speech is the part browsers like to block, so the tone is what guarantees a player at
least hears *that* something was called.

The Web Speech API has several ways of silently doing nothing, and `client/src/speech.ts`
exists to dodge them — Chrome dropping an utterance when you `cancel()` and `speak()` in
the same tick, browsers refusing audio until the page has seen a real user gesture (which
a player waiting for someone *else* to call has not made), voices loading asynchronously,
and a backgrounded tab leaving the engine paused. The first click anywhere in the app is
spent unlocking audio for the rest of the session.

If the browser refuses anyway, the speaker icon in the HUD turns amber and says so,
rather than just going quiet.

If you need more headroom after that, the next thing to look at is the player array in the
snapshot — it's what's left, at roughly 90 bytes per player.

## Notes

- **Why canvas, not DOM?** If the numbers were DOM text, a player could press Ctrl+F and
  the browser would find the called number instantly. Canvas makes that useless. A
  determined player could still read the token list out of devtools — fine for a friendly
  game, but don't play this for money.
- **Reconnects vs. walking out.** Losing your connection is forgiven: identity lives in
  `sessionStorage`, so a refresh or a wifi blip rejoins the same seat with the same score.
  Pressing **Leave** or **Exit room** is final — that player is out of the rotation, can't
  rejoin, and their score still appears on the final leaderboard marked *left early*.
  Because identity is per-tab rather than per-browser, two people can also play from one
  machine in two tabs.
- **A match is a closed table.** Once it starts, nobody new can join; only reconnects get
  through. Set the room up in the lobby first. You can also only be in one room at a time.
- **Names are unique per room**, compared ignoring case and surrounding space, so a
  scoreboard never shows two players called "Meera". Reconnecting with your own name is
  of course fine.
- **The room belongs to its host.** Only they can restart it or close it, and a restart
  needs at least one other player to press *Yes, deal me in* first. Closing the room ends
  it for everybody, with an alert on their screen.
- **Dropouts.** A player who drops mid-turn is skipped rather than stalling the game; the
  host role passes to whoever's still connected, and their open puzzle is held for them
  so a few seconds of bad wifi doesn't cost the round. If a room sits with fewer than two
  people actually connected for 45 seconds, the match finishes on its own — that's the
  difference between someone refreshing and someone closing the tab.
- **Negative scores are real.** A total is never clamped at zero — otherwise a player
  sitting on 0 could click wrong numbers for free. They show in red.
- **Phones and tablets.** Every player gets the same fixed board, which is what keeps the
  race fair, so a small screen zooms rather than getting a different layout. Narrow screens
  open zoomed in to fill the view; pinch or use the buttons to zoom, drag to look around,
  and the reset button puts it back.
- **No database.** Rooms live in a `Map` and are reclaimed once everyone has been gone a
  while. Restarting the server drops every match in progress.

## Deploying to Render

The repo carries a [`render.yaml`](render.yaml) blueprint, so the quickest path is
**New → Blueprint** in the Render dashboard, pointed at this repository. It provisions a
single web service — no database, no worker.

To set it up by hand instead, create a **Web Service** with:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |

Nothing else is required: no environment variables, no secrets. Render injects `PORT`
and the server reads it. `.env.example` documents the few optional knobs that exist.

`npm run build` compiles the server to a single file with esbuild and builds the client
with Vite, and `npm start` runs plain `node` — no TypeScript toolchain at runtime, which
keeps startup quick and memory low enough for the free instance.

Two things to know about the free plan:

- **It sleeps after inactivity**, so the first player to arrive waits a few seconds for a
  cold start. It won't sleep mid-match, because an active match is active traffic.
- **A restart or deploy drops matches in progress**, since state is in memory. Pushing a
  change while people are playing will bounce them to the home screen.

Upgrading to the $7/month instance removes the sleeping; the second point is inherent to
the design and is the thing to fix first if this ever needs to be dependable.

## Commands

```bash
npm run dev        # server on :3001, client on :5173 with a proxy between them
npm test           # vitest: board/puzzle/scoring + the round state machine
npm run typecheck  # tsc across all three packages
npm run build      # bundle the server (esbuild) and build the client (vite)
npm start          # run the built server, which also serves the built client
```

To try the production build locally exactly as Render runs it:

```bash
npm run build && PORT=3010 npm start
```
