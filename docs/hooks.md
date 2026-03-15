# Claude Code Hooks Integration

## What Are Hooks?

[Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) are lifecycle events that fire during a Claude Code session. They let external tools react to what Claude is doing — without terminal scraping or wrapper commands.

code-commentary uses hooks to capture every action Claude takes and turn it into live audio commentary.

## Hook Events Used

| Hook | When It Fires | What We Capture |
|------|---------------|-----------------|
| `PostToolUse` | After every tool call (Bash, Write, Edit, Read, Grep, etc.) | Tool name, input summary, response summary |
| `PostToolUseFailure` | When a tool call fails | Tool name, error message |
| `Stop` | When Claude finishes a response | Task completion marker |
| `Notification` | When Claude needs user input or permission | Notification message |
| `SessionStart` | When a Claude Code session begins | Session start marker |
| `SessionEnd` | When a Claude Code session ends | Session end marker |

## How Hooks Are Installed

`code-commentary init` writes hook configuration into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "code-commentary --hook-event PostToolUse"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "code-commentary --hook-event PostToolUseFailure"
          }
        ]
      }
    ]
  }
}
```

(Similar entries for Stop, Notification, SessionStart, SessionEnd.)

### Merging Behavior

- `init` reads existing settings, deep-merges hooks, and writes back
- It will **not** clobber your existing hooks — code-commentary hooks are added alongside them
- Running `init` multiple times is safe — it skips if hooks are already installed
- `uninstall` removes only code-commentary hooks, leaving everything else untouched

## Hook Handler Behavior

When Claude Code fires a hook, it runs `code-commentary --hook-event <EventName>` and passes structured JSON to stdin.

The hook handler (`hook-handler.js`) must be **fast** — under 50ms. It does no API calls, no audio, no network requests. It:

1. Parses JSON from stdin
2. Extracts relevant fields (tool name, file path, command, error)
3. Strips large payloads (file contents from Write events, long stdout from Bash)
4. Appends a single JSONL line to the event file
5. Exits with code 0 (success — never interfere with Claude Code)

### Input Summarization

To keep event files small and avoid sending source code to the commentary model:

| Tool | What's Kept | What's Stripped |
|------|-------------|-----------------|
| Write | File path only | Full file contents |
| Edit | File path only | Old/new string contents |
| Bash | Command string, description | — |
| Read | File path | File contents in response |
| Grep/Glob | Pattern, path | Match results |

### Response Truncation

Tool responses longer than 500 characters are truncated to first 250 + last 250 characters with `...[truncated]...` in between.
