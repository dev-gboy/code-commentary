# code-commentary

Live sports/podcast-style audio commentary for your AI coding sessions.

It hooks into [Claude Code's](https://docs.anthropic.com/en/docs/claude-code) lifecycle events and narrates what's happening — test failures, file creations, deployments, errors — like a commentator watching a game.

**Two commands to set up. Then just use `claude` normally.**

```bash
npx code-commentary init     # Installs hooks into Claude Code settings
npx code-commentary start    # Starts the commentary daemon
# That's it. Open another terminal, use claude as usual.
```

> "A brand new auth module is being built from scratch — two files down already! But WAIT — the tests come back RED! A TypeError! The agent pivots, makes the fix, runs it again and — GREEN! ALL TESTS PASSING! What a recovery!"

---

## How It Works

```
Claude Code (your terminal)
  │
  ├── Hook: PostToolUse        ──→  code-commentary captures the event
  ├── Hook: PostToolUseFailure ──→  errors and failures
  ├── Hook: Stop               ──→  task completion moments
  ├── Hook: Notification       ──→  Claude needs user input
  ├── Hook: SessionStart       ──→  "And we're live!"
  └── Hook: SessionEnd         ──→  "That's a wrap!"
         │
         ▼
  Event log (JSONL)
         │
         ▼
  Commentary Daemon (persistent WebSocket to Gemini Live API)
    1. Batch events (short debounce window)
    2. Send to Gemini via open WebSocket
    3. Stream audio chunks back as they generate
    4. Play audio via ffplay — starts before generation finishes
```

No terminal scraping. No wrapper commands. No temp files. One persistent WebSocket connection with streaming audio — commentary starts playing ~200-300ms after events arrive.

The model sees **everything** the agent does — file reads, searches, edits, commands, errors — and decides what's worth talking about. It has full session memory, so commentary builds a narrative arc across your entire coding session.

---

## Install

```bash
npm install -g code-commentary
```

### Requirements

- **Node.js** >= 18
- **ffmpeg** (for audio playback via `ffplay`)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: [ffmpeg.org/download](https://ffmpeg.org/download.html)
- **Google AI API key** — get one free at [aistudio.google.com](https://aistudio.google.com/apikey)

---

## Quick Start

```bash
# 1. Set your API key
export GEMINI_API_KEY="your-key-here"

# 2. Install hooks into Claude Code
code-commentary init

# 3. Start the commentary daemon
code-commentary start --style sports --voice Puck

# 4. In another terminal, use Claude Code as usual
claude
# You'll hear live commentary as Claude works!

# 5. When you're done
code-commentary stop

# To completely remove
code-commentary uninstall
```

---

## Commentary Styles

### Sports (default)

Excited play-by-play. Dramatic on errors, triumphant on successes.

> "AND THE TESTS PASS! WHAT A COMEBACK! The agent went straight for the auth module, hit a TypeError on the first attempt, but shook it off and delivered a clean fix!"

### Podcast

Chill, thoughtful observations. Coffee-sipping energy.

> "Oh interesting, it's building out an auth middleware. Hit a snag with the tests — undefined token — but sorted it out pretty quickly. Clean fix."

### Nature

David Attenborough narrating the agent in its natural habitat.

> "The agent constructs its nest with care... two new modules take shape. But nature is unforgiving — a TypeError strikes. Undeterred, the creature adapts... and the colony thrives once more."

### Hype

Everything is the greatest thing in human history.

> "THEY JUST CREATED A NEW FILE! THIS. CHANGES. EVERYTHING! THE AUTH MODULE IS HERE AND THE WORLD WILL NEVER BE THE SAME!"

```bash
code-commentary start --style sports    # default
code-commentary start --style podcast
code-commentary start --style nature
code-commentary start --style hype
```

---

## Language

By default, commentary is in English. Use `--language` to get commentary in any language:

```bash
code-commentary start --language Spanish
code-commentary start --language Japanese --style nature
code-commentary start --language Hindi --style podcast
```

The voice will speak in the chosen language while keeping the same commentary style and personality.

---

## Voices

| Voice | Character | Best for |
|-------|-----------|----------|
| `Puck` | Energetic, youthful | Sports, hype (default) |
| `Kore` | Clear, professional | Sports |
| `Charon` | Deep, authoritative | Nature doc |
| `Aoede` | Warm, expressive | Podcast |
| `Fenrir` | Strong, bold | Hype |
| `Leda` | Calm, measured | Podcast |

Voice tone is steered by the commentary style's system prompt — the sports style sounds excited, podcast sounds chill, nature sounds reverent, etc.

```bash
code-commentary start --voice Puck --style sports
code-commentary start --voice Charon --style nature
code-commentary start --voice Aoede --style podcast
code-commentary start --voice Fenrir --style hype
```

---

## CLI Reference

### `code-commentary init`

Installs hooks into `~/.claude/settings.json`. Safe to run multiple times — it won't duplicate hooks or clobber your existing settings.

### `code-commentary start [options]`

Starts the commentary daemon. Opens a persistent WebSocket to the Gemini Live API and streams audio commentary as events arrive.

| Option | Description | Default |
|--------|-------------|---------|
| `--style <name>` | Commentary style: `sports`, `podcast`, `nature`, `hype` | `sports` |
| `--voice <name>` | TTS voice: `Puck`, `Kore`, `Charon`, `Aoede`, `Fenrir`, `Leda` | `Puck` |
| `--interval <sec>` | Minimum seconds between commentary batches | `4` |
| `--session-ttl <min>` | Reconnect after N minutes (resets context to manage costs) | `30` |
| `--silent` | Text-only mode (no audio) | — |
| `--verbose` | Print raw events and debug info | — |
| `--background` | Daemonize (writes PID to `/tmp/code-commentary.pid`) | — |
| `--language <lang>` | Commentary language (e.g. `Spanish`, `Japanese`, `Hindi`) | — |
| `--api-key <key>` | Google AI API key (or set `GEMINI_API_KEY` env var) | — |

### `code-commentary stop`

Stops the background daemon.

### `code-commentary uninstall`

Removes all code-commentary hooks from `~/.claude/settings.json`. Clean removal — leaves your other settings untouched.

---

## Session Memory

The Gemini Live API is stateful — the model remembers everything within a session. This means commentary builds over time:

- "They're BACK at that auth file — third time this session!"
- "Remember those test failures earlier? All green now. Redemption arc complete."
- "After reading through five files, it's finally making its move..."

Sessions auto-rotate every 30 minutes by default (configurable with `--session-ttl`) to keep context costs manageable.

---

## What the Model Sees

Every event from Claude Code is sent to the commentary model:

- **File reads** — the agent is researching
- **Searches** (Grep/Glob) — the agent is looking for something
- **File creates and edits** — the agent is building
- **Bash commands** — test runs, builds, installs (with pass/fail)
- **Errors and failures** — something went wrong
- **Task completions** — the agent finished a response
- **Session start/end** — session boundaries
- **Permission requests** — the agent needs user input

The model decides what's interesting enough to commentate. Only exact duplicate events (same file touched within 2 seconds) are deduplicated.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Claude Code (user's terminal)                   │
│                                                  │
│  Hooks fire on every tool use, error,            │
│  session event → runs code-commentary            │
│  hook handler (fast, <50ms, no API calls)        │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
    /tmp/code-commentary/{session_id}.jsonl
    (one JSON line per event)
                   │
                   │  daemon polls every 500ms
                   ▼
┌─────────────────────────────────────────────────┐
│  Commentary Daemon                               │
│                                                  │
│  Persistent WebSocket ←→ Gemini Live API         │
│  (gemini-2.5-flash-native-audio)                 │
│                                                  │
│  Events in → audio chunks stream back            │
│  → piped directly to ffplay stdin                │
│  → audio plays while model still generates       │
└─────────────────────────────────────────────────┘
```

### Why Live API instead of REST?

| | REST (2-step) | Live API (current) |
|---|---|---|
| Time to first audio | ~800ms-1.5s | ~200-300ms |
| API calls per commentary | 2 (LLM + TTS) | 0 (persistent WebSocket) |
| Connection overhead | New HTTP connection each time | Zero |
| Temp files | Yes (PCM file per utterance) | No (stream to ffplay stdin) |
| Session memory | None | Full session context |
| Dependencies | @google/genai | ws |

---

## Cost

Uses a single Gemini 2.5 Flash native audio model via the Live API for both thinking and speaking.

Session context accumulates over time, so longer sessions cost more per turn. The `--session-ttl` flag (default 30 min) auto-rotates the session to keep costs predictable.

With `--silent` (text only, no audio): significantly cheaper since it requests text modality only.

---

## Stack

| Layer | Tool |
|-------|------|
| Commentary + voice | Gemini 2.5 Flash (native audio, Live API) |
| Integration | Claude Code Hooks |
| Audio playback | ffplay (ffmpeg) via stdin streaming |
| Transport | WebSocket (ws) |
| Runtime | Node.js — single npm dependency |

---

## Troubleshooting

**"ffplay not found"**
Install ffmpeg: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Linux).

**No audio playing**
- Make sure the daemon is running (`code-commentary start`)
- Check that hooks are installed (`code-commentary init`)
- Verify your API key: `echo $GEMINI_API_KEY`
- Try `--verbose` to see raw events, audio chunk delivery, and errors

**No commentary at all**
- Run `code-commentary init` to install hooks
- Make sure you're using Claude Code (the CLI tool) — hooks don't work with the Claude web app

**Commentary feels disconnected**
The model has session memory and sees all events including file reads and searches. If commentary still feels random, try `--verbose` to confirm events are flowing.

**Session memory getting stale/expensive**
Adjust `--session-ttl` to rotate sessions more or less frequently. Lower = fresher context, higher = longer memory.

---

## License

MIT
