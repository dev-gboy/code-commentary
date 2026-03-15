# Troubleshooting

## No Audio Playing

**Check ffplay is installed:**
```bash
ffplay -version
```
If not found, install ffmpeg:
- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`
- Arch: `pacman -S ffmpeg`

**Check the daemon is running:**
The daemon must be running in a separate terminal (or background) while you use Claude Code.
```bash
code-commentary start --verbose
```

**Check your API key:**
```bash
echo $GEMINI_API_KEY
```
The key must be set in the same shell where you run `code-commentary start`.

**Check hooks are installed:**
```bash
cat ~/.claude/settings.json | grep code-commentary
```
If nothing shows up, run `code-commentary init`.

**Use `--verbose` to diagnose:**
Run with `--verbose` to see detailed debug output:
```bash
code-commentary start --verbose
```

What to look for:
| Log line | Meaning |
|----------|---------|
| `[EVENTS] PostToolUse:Write, ...` | Events are arriving from hooks — good |
| `[AUDIO] First chunk received` | Live API is sending audio — good |
| `[WS] Turn complete` | Model finished responding — good |
| `[WS] Cannot send — not connected` | WebSocket died — daemon will auto-reconnect |
| `[WS] Closed: <code>` | WebSocket connection dropped |
| `[WS] Unhandled: ...` | Unexpected message from the API — may indicate an error |
| `[DAEMON] Turn timed out after 15s` | Model didn't respond — possible API issue |
| `[DAEMON] Send failed, skipping` | WebSocket was dead when trying to send |
| `[INIT] Skipping N bytes` | Daemon skipped past old events on startup — normal |

## Audio Cuts Off Abruptly

The daemon waits for each utterance to finish playing before processing the next batch. If audio still cuts off:

- The `max_output_tokens` is set to 120 to keep responses short
- The system prompt instructs the model to keep commentary to 1-3 sentences
- Try increasing `--interval` to give more time between batches

## Commentary Feels Disconnected

The model has full session memory via the Live API WebSocket. It sees every event — file reads, searches, edits, commands, errors. If commentary still feels random:

1. Run with `--verbose` to confirm events are flowing
2. Check that the daemon started **after** Claude Code — it skips events that happened before startup
3. Try lowering `--interval` so the model sees events in smaller, more contextual batches

## No Events Showing Up

**Verify hooks are firing:**
```bash
code-commentary start --verbose
```
Then use Claude Code in another terminal. You should see `[EVENTS]` lines in the daemon output.

**Check the event file exists:**
```bash
ls /tmp/code-commentary/  # Linux
ls $TMPDIR/code-commentary/  # macOS
```

**Make sure you're using Claude Code CLI:**
Hooks only work with the Claude Code CLI tool (`claude` command). They don't fire from the Claude web app, API, or other interfaces.

## WebSocket Connection Failures

**"WebSocket connection timeout":**
- Check your internet connection
- Verify your API key is valid
- The Gemini Live API may be experiencing issues — check [Google AI status](https://status.cloud.google.com/)

**Frequent disconnections:**
The daemon auto-reconnects when the WebSocket drops. If you see frequent `[WS] Closed:` messages in `--verbose` mode, it may be a network stability issue. The `--session-ttl` flag controls intentional reconnections (default: every 30 minutes).

**"Cannot send — not connected":**
The WebSocket dropped between events. The daemon will attempt to reconnect automatically on the next batch. If this happens repeatedly, check your network or API key.

## Daemon Hangs / No Output

If the daemon seems stuck (events show up but nothing happens after):

- There's a 15-second timeout on each turn — if the model doesn't respond, the daemon moves on
- Check `--verbose` for `[DAEMON] Turn timed out` messages
- The API may be overloaded — try again later
- Try `code-commentary stop` then restart

## High Costs

Context accumulates in the Live API session. Longer sessions = more context per turn = higher costs.

**To reduce costs:**
- Lower `--session-ttl` (e.g., `--session-ttl 15`) to rotate sessions more frequently
- Increase `--interval` to generate commentary less often
- Use `--silent` for text-only mode (no audio generation)

## Removing code-commentary

**Remove hooks:**
```bash
code-commentary uninstall
```

**Stop the daemon:**
```bash
code-commentary stop
```

**Uninstall globally:**
```bash
npm uninstall -g code-commentary
```

**Clean up event files:**
```bash
rm -rf $TMPDIR/code-commentary  # macOS
rm -rf /tmp/code-commentary     # Linux
```
