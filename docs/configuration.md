# Configuration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google AI API key. Required unless passed via `--api-key`. Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |

## CLI Options

All options are passed to `code-commentary start`:

### `--style <name>`

Commentary personality. Default: `sports`.

| Style | Personality |
|-------|-------------|
| `sports` | Excited play-by-play commentator. Dramatic on errors, triumphant on successes. |
| `podcast` | Chill podcast host. Warm, conversational, coffee-sipping energy. |
| `nature` | David Attenborough narrating a nature documentary. Reverent and hushed. |
| `hype` | Over-the-top hype person. Everything is the greatest thing ever. |

### `--voice <name>`

Gemini TTS voice. Default: `Puck`.

| Voice | Character |
|-------|-----------|
| `Puck` | Energetic, youthful |
| `Kore` | Clear, professional |
| `Charon` | Deep, authoritative |
| `Aoede` | Warm, expressive |
| `Fenrir` | Strong, bold |
| `Leda` | Calm, measured |

### `--interval <seconds>`

Minimum seconds between commentary batches. Default: `4`.

Lower values mean more frequent commentary (and higher API costs). Higher values batch more events together for less frequent but more contextual commentary.

### `--session-ttl <minutes>`

How long before the WebSocket session is rotated. Default: `30`.

The Live API accumulates context over time — every turn includes all previous turns. Rotating the session resets this context, keeping costs predictable. Set to `0` to disable rotation (infinite session memory, but costs grow over time).

### `--silent`

Text-only mode. Requests TEXT modality from the API instead of AUDIO. Commentary is printed to the terminal but not spoken. Much cheaper since there's no audio generation.

### `--verbose`

Debug mode. Prints:
- Raw event names as they're processed
- Audio chunk delivery confirmations
- Session reconnection events
- Error details

### `--background`

Daemonize the process. Writes PID to `/tmp/code-commentary.pid`. Stop with `code-commentary stop`.

### `--language <lang>`

Language for the commentary. Default: none (English).

Pass any language name (e.g. `Spanish`, `Japanese`, `Hindi`, `French`, `Korean`). The system prompt is modified to instruct the model to speak entirely in the chosen language. The commentary style and personality remain the same.

```bash
code-commentary start --language Spanish
code-commentary start --language Japanese --style nature --voice Charon
```

### `--api-key <key>`

Google AI API key. Alternative to setting `GEMINI_API_KEY` environment variable.

## Recommended Configurations

**Focused coding session (low noise):**
```bash
code-commentary start --style podcast --voice Aoede --interval 8
```

**High-energy pair programming:**
```bash
code-commentary start --style sports --voice Puck --interval 3
```

**Ambient background narration:**
```bash
code-commentary start --style nature --voice Charon --interval 10
```

**Demo / presentation:**
```bash
code-commentary start --style hype --voice Fenrir --interval 3
```

**Non-English commentary:**
```bash
code-commentary start --language Spanish --style sports --voice Puck
```

**Cost-conscious (text only):**
```bash
code-commentary start --silent --style podcast
```
