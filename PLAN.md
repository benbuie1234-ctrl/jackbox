# Family Party Pack — Build Plan

Goal: a TV + phones party game for family night. The laptop casts the **Host screen** to the TV; everyone joins on their phone with a **4-letter room code** at a short URL. Deployed to Cloudflare straight from GitHub.

> Scope note: we're building the *genre* (room-code party games with phones as controllers) with our own names, art, and prompts. We're not copying Jackbox's game titles, characters, logos, fonts, or prompt text.

---

## 1. How the "Jackbox feel" actually works (what we replicate)

| Detail | How we do it |
|---|---|
| Big room code + URL on TV | Lobby shows `yoursite.com` and a 4-letter code (no confusable letters: no I/O/0/1). QR code too, so phones can just scan. |
| Join with name only | Phone page: Room code + Name (max 12 chars). No accounts. |
| VIP | First player to join gets a crown and the **Everybody's In** button on their phone. The TV never needs a mouse after setup. |
| Avatars / colors | Each player gets a unique color and a simple doodle avatar (drawn on their phone in the lobby, optional). |
| Reconnect | Player ID saved in `localStorage`; refreshing or locking the phone rejoins you in the same spot. |
| Timers | Big countdown ring on TV, small timer on phones, a "tick tick" sound for the last 10s. "Extra time" toggle in settings for grandparents. |
| Host voice | Browser text-to-speech reads prompts and makes snarky comments ("Wow. Bold choice."). Toggle on/off. |
| Music + SFX | Looping lobby music and stingers made with Web Audio (no licensed audio). |
| Reveal drama | Answers slide in one at a time, votes fly in as colored player dots, "QUIPLASH-style" sweep → our version: **"SWEEP!"** banner when one answer gets every vote. |
| Audience | Players past 8 join as audience; they vote and their votes count as a bonus. |
| Family filter | Curated prompt packs marked `family`; optional profanity filter on answers; VIP can kick/censor an answer. |
| Scoreboard | Animated bar race between rounds; winner screen with confetti. |

## 2. The games — a 5-game pack modeled on the *formats* of Party Pack 3

Same five play styles that made Pack 3 a hit, with our own names, look, characters and prompts.

| Pack 3 format | Our game | How it plays |
|---|---|---|
| Head-to-head funny answers | **Zinger** | Each prompt goes to 2 players, everyone else votes. Sweep bonus. 2 rounds + a final round where everyone answers one prompt and spreads 3 votes. 3–8 players. |
| Spooky trivia with "death" minigames | **Haunted Quiz Night** | Trivia questions on phones. Wrong answers send you to a quick survival minigame (pick the safe door, solve a math dash, memory flash). Lose it and you become a ghost who can still answer but scores differently. Ends with a race to the exit: pick the right categories to move forward. 1–8 players. |
| Guess the poll percentage | **Hunch** | Survey question ("What % of Americans have eaten pie for breakfast?"). One player sets a guess with a slider; everyone else bets higher or lower. Rotate. Final round: pick the top 3 answers from a list. 2–8 players. |
| Social deduction "who's faking" | **Faker Among Us** | Everyone but one player gets a secret instruction ("Raise your hand if you've ever lied about brushing your teeth", "Point at the best cook"). The faker has to blend in. Everyone votes on who the faker is. Great in person with family. 3–8 players. |
| Draw + slogan + head-to-head shirts | **Tee Time** | Everyone draws pictures and writes slogans on their phone. You get dealt others' drawings and slogans and combine them into a T-shirt. Shirts face off in a bracket; the champion shirt wins. 3–8 players. |

Easiest to hardest to build: Zinger → Hunch → Faker Among Us → Haunted Quiz Night → Tee Time.

## 3. Architecture (Cloudflare)

```
Phone / TV browser  ──WebSocket──►  Cloudflare Worker  ──►  Durable Object "Room" (one per room code)
        ▲                                │                     • state saved to DO storage on every change
        └────── static HTML/JS/CSS ◄─────┘                     • runs timers with alarms
                (Workers static assets)                        • broadcasts state to TV + phones
```

- **One Cloudflare Worker** serves the static site and upgrades `/ws/:code` to a WebSocket into a **Durable Object** for that room. Durable Objects work on the free plan (SQLite-backed class).
- **Server is the source of truth.** It sends each client only what they need (TV gets everything; a phone gets its own prompt, never the other answers early → no peeking/cheating).
- **Host screen** `/host` → creates a room, shows lobby. **Player screen** `/` → enter code + name.
- **Tech:** plain JavaScript + CSS, **no build step** (no React, no Vite). `wrangler` for the Worker. One repo, `npm run dev` for local testing with several browser tabs.
- **Deploy:** you connect the GitHub repo in Cloudflare → *Workers & Pages → Create → Import a repository* (Workers Builds, not classic Pages, because we need Durable Objects). Build command: none. Deploy command `npx wrangler deploy`. Every push to `main` redeploys.

### Message shape (sketch)
- Client → server: `join {name, playerId}`, `start`, `submit {promptId, text}`, `vote {choice}`, `drawing {strokes}`.
- Server → client: `state {phase, timer, you, players, ...}` — one message type, the screen just re-renders from it. Simple and reconnect-proof.

## 4. Build order (tonight-sized)

1. **Platform (≈1 hr):** Worker + Room DO, lobby, room code, QR, VIP start, reconnect, timers, scoreboard, TV/phone layouts, sound + TTS, game-select menu.
2. **Zinger (≈45 min)** + ~150 family-friendly prompts.
3. **Hunch (≈30 min)** + ~50 poll questions with real-ish percentages.
4. **Faker Among Us (≈30 min)** + ~40 instruction sets.
5. **Haunted Quiz Night (≈1 hr)** + ~80 trivia questions + 3 minigames.
6. **Tee Time (≈1 hr)** — drawing canvas, shirt combiner, bracket.
7. **Test** locally with 4–6 tabs, then on real phones on the deployed URL.

All five is roughly 5 hours. For tonight, play what's ready and keep building the rest for the next family night.

## 5. Ideas that make it better than the real thing (for a family)

- **Inside-joke prompts:** a setup page where you type family names/in-jokes ("Uncle Dave's famous chili") that get mixed into prompts. This will be the funniest thing all night.
- **Holiday pack:** Thanksgiving-themed prompts and facts.
- **Kid mode:** shorter text, picture-choice voting, longer timers, no negative jokes about players.
- **No limits on content refresh:** add prompts by editing one JSON file.
- **Highlight reel:** at the end, the TV replays the top 5 most-voted answers of the night.
- **Phone-as-buzzer reactions:** tap emoji reactions that float on the TV during reveals.
- **Name the winner's prize:** VIP types the prize at the start ("gets the last slice of pie").

## 6. Risks / gotchas

- **Phones sleeping** drop the WebSocket → auto-reconnect + `state` resend handles it; use Wake Lock API where supported.
- **Casting lag** (Chromecast/AirPlay tab cast) is fine; all input is on phones. Use full-screen (F) on the host page.
- **Audio over casting**: make sure the tab's audio goes to the TV; add a "Test sound" button in the lobby.
- **iOS Safari TTS** only plays after a tap → that's fine since TTS runs on the laptop, not phones.
- **Wi-Fi not needed to match** — everything goes through Cloudflare, so cellular phones work too.

---

# 7. Build spec for tonight (locked in)

Scope tonight: **shared platform + Zinger + Hunch + Faker Among Us.** Haunted Quiz Night and Tee Time come later.
Pack name on screen: **COUCH CHAOS**. Our own names, art and prompts throughout; no Jackbox titles, characters or text.

## 7.1 Durable Objects & hibernation safety
- Each room is one SQLite-backed Durable Object (free plan). WebSockets use the **Hibernation API** (`ctx.acceptWebSocket`), with `ping`/`pong` auto-responses so idle phones don't wake the room.
- **All state is saved to `ctx.storage` on every change** (`state` key; avatars stored separately under `av:<id>`). The constructor reloads it, so a room that hibernates mid-game wakes up exactly where it was.
- **Timers use `ctx.storage.setAlarm()`**, never `setInterval`. One alarm serves an event queue (phase timeouts + bot actions), each tagged with the phase it belongs to so stale events are dropped.
- Typed drafts are sent to the server while you type and saved, so auto-submit works even after a hibernation.
- **Reconnect:** phones store `roomCode + playerId` in `localStorage`. On refresh / lock / app switch they reconnect (backoff + on `visibilitychange`) and get their exact seat, avatar, score and current prompt/vote back. No duplicate players; an older socket for the same player is closed. Joining with the name of a disconnected player reclaims that seat.
- **"Add 3 Bots"** (subtle button in the TV lobby): bots write placeholder answers, slide, bet and vote at random with small delays, so full rounds, ties, ZINGs and scoreboards can be solo-tested. In Faker they only vote (they can't raise hands).
- Minimum players: Zinger 3, Hunch 2, Faker 3 (bots count). Max 10.

## 7.2 Laptop → TV
- All TV content sits inside a **90% safe zone** (5% padding each side). Prompt/answer type is sized in `vh` and never below ~36px at 1080p.
- **No interactive buttons on the TV** except the lobby's: big **CLICK TO UNMUTE TV AUDIO** banner (unlocks Web Audio + speech), subtle Add/Remove Bots, and small corner Voice / Music / Fullscreen toggles. Everything else is driven from the VIP's phone.

## 7.3 Feel & juice
- **Look:** "Saturday night broadcast game show": 4px #111 borders, 6px hard offset shadows, cards tilted ±2°, chunky display type (Fredoka + Archivo Black), high-contrast studio colors.
- **Per-game themes:** Zinger = royal blue + hot pink comedy club with sweeping spotlights. Hunch = 70s/80s gold, teal, burnt orange with a giant speedometer dial. Faker = noir crimson, charcoal, yellow caution tape.
- **Motion (CSS keyframes, no Framer Motion):** diagonal screen wipe between every phase, spring-overshoot slam-ins (nothing just fades), tug-of-war vote bar, screen shake + stamp + confetti on ZING!, lobby doodles bounce in with their own chime and idle breathing.
- **Synth audio (Web Audio, no MP3s):** per-game funky loop that speeds up and pitches up in the last 10s of any timer. SFX: rising join pops, pneumatic submit thwump, card-slam whoosh, woodblock vote ticks, lock-in ding, drumroll, brass ZING!, buzzer, countdown beeps, podium fanfare. Music ducks under the voice.
- **Voice:** `speechSynthesis` with the most natural English voice on the laptop; toggle on the TV. Reads prompts, answers, winners. Reveal pacing follows the voice (the TV tells the server when a reveal finishes, with a timeout fallback).
- **Phones are controllers:** when the action is on the TV, phones show **EYES ON THE TV!** with 4 big reaction buttons (😂 😱 👏 🍅) that float emojis up the TV. Text inputs live in the upper third of the phone. `100dvh` layout. `navigator.vibrate()` on taps and lock-ins (Android; iPhones ignore it).

## 7.4 Game mechanics
**Zinger** (head-to-head answers)
- Rounds 1 & 2: players in a ring, prompt *i* goes to players *i* and *i+1* → every prompt has exactly 2 authors, every player gets exactly 2 prompts. 90s to write.
- Reveal beat: prompt (voiced) → Answer A slams in (voiced) → 1.5s pause → Answer B slams in → voting opens. Authors can't vote on their own matchup.
- Score: 100/vote, +100 for winning, **ZING!** (all votes, at least 2 voters) +250 with shake/stamp/brass. Round 2 doubles everything.
- **Panic button**: silly auto-answer for half points. Timer at zero auto-submits your typed text, or a fallback like "I panicked".
- Round 3 (Final): everyone answers the same prompt; each player hands out Gold/Silver/Bronze (300/200/100) to others' answers.

**Hunch** (guess the percentage)
- Rotating guesser drags a giant 0–100% slider; the TV dial needle follows live. Everyone else bets HIGHER / LOWER (500) or MUCH HIGHER / MUCH LOWER (1000, only if off by more than 15, otherwise 0).
- Guesser scores up to 1000 by closeness, +500 bullseye (within 2). Reveal bar creeps up, pauses with a drumroll, then slams the real number.
- 2 rounds if ≤4 players (round 2 doubled), otherwise 1. Final: everyone guesses the same question; closest scores up to 2000.
- Questions are verifiable facts and counts (water on Earth, piano keys, Monopoly spaces…), not made-up poll numbers.

**Faker Among Us** (in-person bluffing)
- 3 cases: **Raise Your Hand**, **Point at Someone**, **Hold Up Fingers (1–5)**. One secret faker per case who only sees the category.
- Phones show the task → TV **3… 2… 1… DO IT NOW!** with chime → **FREEZE!** → only then the TV reveals the task. Room argues; the VIP taps **Start Vote** (or 60s runs out).
- Up to **3 strikes** per case: wrong accusation = **INNOCENT!** stamp and a new task with the same faker. Catch the faker: voters +250 +500 bonus. Faker gets +500 per task survived, +1000 for escaping.

## 7.5 Phone UX guardrails
- `100dvh`, inputs in the upper third, giant buttons, no scoreboards on phones.
- Auto-submit on timeout; you never see your own answer as a vote option.
- Join screen: code (pre-filled from QR), name, **finger-doodle avatar** (4 colors + Clear) that bounces onto the TV lobby.

## 7.6 End of game
- Podium with fanfare + confetti, **superlatives** (Speed Demon, Crowd Favorite = most reactions received, Hype Machine, plus per-game: Zing Machine / Human Calculator / Master Bluff / Sharp Eye) and the **top quote** of the game.
- VIP phone: **Play Again**, **Switch Game (Keep Everyone Joined)**. Players, names and doodles stay.
- Kid Mode toggle on the VIP phone: 1.5× longer input timers.
