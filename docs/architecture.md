# Architecture

## Overview

code-commentary has three main components:

1. **Hook handler** — a lightweight script that runs inside Claude Code on every lifecycle event
2. **Event log** — a JSONL file that stores structured events
3. **Commentary daemon** — a background process that reads events and generates live audio commentary

```
┌─────────────────────────────────────────────────┐
│  Claude Code                                     │
│                                                  │
│  Every tool use, error, session event triggers   │
│  a hook that runs: code-commentary --hook-event  │
│  (reads JSON from stdin, appends to event file)  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
    /tmp/code-commentary/{session_id}.jsonl
                   │
                   │  daemon polls every 500ms
                   ▼
┌─────────────────────────────────────────────────┐
│  Commentary Daemon                               │
│                                                  │
│  WebSocket ←→ Gemini Live API                    │
│  (gemini-2.5-flash-native-audio)                 │
│                                                  │
│  Events in → audio chunks stream back            │
│  → piped to ffplay stdin                         │
│  → plays while model still generating            │
└─────────────────────────────────────────────────┘
```

## Hook Handler (`hook-handler.js`)

Runs inside Claude Code's hook system. Called on every event. Must be **fast** (< 50ms) — no API calls, no audio, no network. Its only job:

1. Read JSON from stdin (Claude Code passes structured event data)
2. Summarize the event (strip large file contents, truncate long responses)
3. Append a single JSONL line to `/tmp/code-commentary/{session_id}.jsonl`
4. Write the session ID to a `latest-session` file so the daemon knows what to tail

## Event Log

One JSONL file per Claude Code session. Each line contains:

```json
{
  "timestamp": 1710000000000,
  "event": "PostToolUse",
  "tool": "Write",
  "input": { "file_path": "src/auth.ts" },
  "response": "ok",
  "error": null,
  "message": null,
  "session_id": "abc-123",
  "cwd": "/Users/you/project"
}
```

The `summarizeInput` function strips file contents from Write events — only the file path is stored. This keeps the event log small and avoids sending source code to the commentary model.

## Commentary Daemon (`daemon.js`)

The main event loop:

1. **Poll** — checks the event file every 500ms for new lines
2. **Debounce** — waits 800ms after new events arrive to batch rapid-fire events
3. **Deduplicate** — removes identical events (same tool + same file within 2 seconds)
4. **Format** — converts events into human-readable one-liners
5. **Send** — pushes formatted text to the Gemini Live API over WebSocket
6. **Stream** — audio chunks arrive and are piped directly to ffplay's stdin
7. **Wait** — blocks until the current utterance finishes playing before processing the next batch

## Live API Session (`live-session.js`)

A persistent WebSocket connection to the Gemini Live API. Key properties:

- **One connection per daemon lifetime** (or until session TTL rotates it)
- **Setup message** sent on connect configures model, voice, system prompt
- **Session memory** — the model remembers all previous turns, building narrative context
- **Auto-reconnect** — if the WebSocket drops, the daemon reconnects transparently

## Streaming Audio Player (`audio-player.js`)

Each utterance spawns a fresh ffplay process. Audio chunks are piped to ffplay's stdin as they arrive from the Live API — playback starts from the first chunk, not after the entire response is generated.

When the model signals turn complete, stdin is closed and the daemon waits for ffplay to finish playing all buffered audio before processing the next batch.

## Event Flow Timeline

```
T+0ms     Hook fires in Claude Code
T+5ms     Hook handler appends JSONL line
T+500ms   Daemon polls, finds new event
T+1300ms  Debounce fires, sends to WebSocket
T+1500ms  First audio chunk arrives from Live API
T+1500ms  ffplay starts playing immediately
T+3000ms  Model finishes, turn complete
T+4000ms  ffplay finishes playing buffered audio
T+4000ms  Daemon ready for next batch
```
