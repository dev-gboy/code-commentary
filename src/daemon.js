const fs = require('fs');
const path = require('path');
const { EVENTS_DIR } = require('./config');
const { deduplicateEvents, filterForCodingBuddy } = require('./filter');
const { LiveSession } = require('./live-session');
const { StreamingPlayer } = require('./audio-player');
const { getPrompt } = require('./prompts');

function formatEvents(events) {
  return events.map(e => {
    if (e.event === 'PostToolUse' && e.tool === 'Bash') {
      const cmd = e.input?.command || 'unknown command';
      const exitCode = e.exit_code ?? e.response?.exit_code;
      const status = exitCode === 0 ? 'succeeded' : (exitCode !== undefined ? 'FAILED' : 'ran');
      return `[COMMAND] ${cmd} → ${status}`;
    }
    if (e.event === 'PostToolUse' && e.tool === 'Write') {
      return `[FILE CREATED] ${e.input?.file_path || 'unknown'}`;
    }
    if (e.event === 'PostToolUse' && (e.tool === 'Edit' || e.tool === 'MultiEdit')) {
      return `[FILE EDITED] ${e.input?.file_path || 'unknown'}`;
    }
    if (e.event === 'PostToolUse' && e.tool === 'Read') {
      return `[FILE READ] ${e.input?.file_path || 'unknown'}`;
    }
    if (e.event === 'PostToolUse' && (e.tool === 'Grep' || e.tool === 'Glob')) {
      return `[SEARCH] ${e.tool}: ${e.input?.pattern || e.input?.file_path || 'unknown'}`;
    }
    if (e.event === 'PostToolUseFailure') {
      return `[ERROR] ${e.tool || 'unknown'}: ${e.error || 'unknown error'}`;
    }
    if (e.event === 'Stop') {
      const summary = e.last_assistant_message
        ? e.last_assistant_message.slice(0, 300)
        : '';
      return `[TASK COMPLETE]${summary ? ' ' + summary : ''}`;
    }
    if (e.event === 'UserPromptSubmit') return `[USER PROMPT] ${e.user_prompt || ''}`;
    if (e.event === 'Notification') return `[NEEDS INPUT] ${e.message || ''}`;
    if (e.event === 'SessionStart') return '[SESSION STARTED]';
    if (e.event === 'SessionEnd') return '[SESSION ENDED]';
    return `[${e.event}] ${e.tool || ''}`;
  }).join('\n');
}

async function startDaemon(config) {
  if (!config.apiKey) {
    console.error('Error: No API key. Set GEMINI_API_KEY env var or use --api-key <key>');
    process.exit(1);
  }

  fs.mkdirSync(EVENTS_DIR, { recursive: true });

  const usePlayer = !config.silent && !config.jsonOutput;
  const player = usePlayer ? new StreamingPlayer() : null;
  const session = new LiveSession({
    apiKey: config.apiKey,
    voice: config.voice,
    systemPrompt: getPrompt(config.style, config.language),
    silent: config.silent,
    verbose: config.verbose,
  });

  function jsonOut(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  // Wire audio chunks from Live API → player or JSON output
  let chunkCount = 0;
  if (!config.silent) {
    session.onAudioChunk = (base64Data) => {
      chunkCount++;
      if (chunkCount === 1 && config.verbose) {
        console.error('\x1b[90m[AUDIO] First chunk received\x1b[0m');
      }
      if (config.jsonOutput) {
        jsonOut({ type: 'audio', data: base64Data });
      } else if (player) {
        player.feedChunk(base64Data);
      }
    };
  }

  // Collect text for silent mode
  let textBuffer = '';
  session.onText = (text) => {
    textBuffer += text;
  };

  // In json-output mode, use stderr for log messages to keep stdout clean for JSON
  const log = config.jsonOutput ? (...a) => console.error(...a) : (...a) => console.log(...a);

  // Connect
  log('\x1b[35m🎙️  Connecting to Gemini Live API...\x1b[0m');
  try {
    await session.connect();
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    process.exit(1);
  }
  log('\x1b[35m🎙️  code-commentary is live. Waiting for Claude Code events...\x1b[0m\n');
  log(`   Style: ${config.style} | Voice: ${config.voice}`);
  if (config.silent) log('   Mode: text-only (no audio)');
  log('   Press Ctrl+C to stop.\n');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n\x1b[35m🎙️  That\'s a wrap! code-commentary signing off.\x1b[0m');
    if (player) player.kill();
    session.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Session TTL — reconnect periodically to manage context costs
  if (config.sessionTtl > 0) {
    setInterval(async () => {
      if (config.verbose) console.log('\x1b[90m[SESSION] Rotating session to manage context costs\x1b[0m');
      try {
        await session.reconnect();
      } catch (err) {
        if (config.verbose) console.error('Reconnect error:', err.message);
      }
    }, config.sessionTtl * 60 * 1000);
  }

  let isProcessing = false;
  let eventBuffer = [];
  let lastEventFile = null;
  let fileOffset = 0;
  let debounceTimer = null;

  // Skip past existing events on startup — only commentate new ones
  try {
    const latestFile = path.join(EVENTS_DIR, 'latest-session');
    if (fs.existsSync(latestFile)) {
      const sessionId = fs.readFileSync(latestFile, 'utf8').trim();
      if (sessionId) {
        const eventFile = path.join(EVENTS_DIR, `${sessionId}.jsonl`);
        if (fs.existsSync(eventFile)) {
          lastEventFile = eventFile;
          fileOffset = fs.statSync(eventFile).size;
          if (config.verbose) {
            console.log(`\x1b[90m[INIT] Skipping ${fileOffset} bytes of existing events\x1b[0m`);
          }
        }
      }
    }
  } catch {};

  // Process buffered events
  async function processEvents() {
    if (isProcessing || eventBuffer.length === 0) return;
    isProcessing = true;

    const events = eventBuffer.splice(0);
    const interesting = config.style === 'coding-buddy'
      ? filterForCodingBuddy(events)
      : deduplicateEvents(events);

    if (interesting.length === 0) {
      isProcessing = false;
      return;
    }

    const eventSummary = formatEvents(interesting);

    if (config.verbose) {
      console.log(`\n\x1b[90m[EVENTS] ${interesting.map(e => `${e.event}:${e.tool || ''}`).join(', ')}\x1b[0m`);
    }

    // Auto-reconnect if disconnected
    if (!session.connected) {
      try {
        if (config.verbose) console.log('\x1b[90m[SESSION] Reconnecting...\x1b[0m');
        await session.reconnect();
      } catch (err) {
        if (config.verbose) console.error('Reconnect failed:', err.message);
        isProcessing = false;
        return;
      }
    }

    textBuffer = '';
    chunkCount = 0;

    // Send to Live API — audio starts streaming back immediately
    const sent = session.sendText(eventSummary);

    if (!sent) {
      if (config.verbose) console.log('\x1b[90m[DAEMON] Send failed, skipping\x1b[0m');
      isProcessing = false;
      return;
    }

    // Wait for turn to complete (with timeout to prevent hanging)
    await new Promise((resolve) => {
      const turnTimeout = setTimeout(() => {
        if (config.verbose) console.log('\x1b[90m[DAEMON] Turn timed out after 15s\x1b[0m');
        resolve();
      }, 15000);

      session.onTurnComplete = () => {
        clearTimeout(turnTimeout);
        if (config.jsonOutput) {
          jsonOut({ type: 'end_utterance' });
          resolve();
        } else if (player) {
          player.endUtterance().then(resolve);
        } else {
          resolve();
        }
      };
    });

    // SKIP detection for coding-buddy: Gemini responds with "." when nothing is noteworthy
    const text = textBuffer.trim();
    if (text === '.' || text === '') {
      if (config.verbose) log('\x1b[90m[DAEMON] Skipped (not noteworthy)\x1b[0m');
      isProcessing = false;
      if (eventBuffer.length > 0) scheduleProcessing();
      return;
    }

    // Print text (in silent mode this is the commentary, in audio mode it may be empty)
    if (text) {
      if (config.jsonOutput) {
        jsonOut({ type: 'text', data: text });
      } else {
        console.log(`\x1b[33m🎙️  ${text}\x1b[0m`);
      }
    }

    isProcessing = false;

    if (eventBuffer.length > 0) {
      scheduleProcessing();
    }
  }

  function scheduleProcessing() {
    if (debounceTimer) clearTimeout(debounceTimer);
    const debounceMs = config.style === 'coding-buddy' ? 2500 : 800;
    debounceTimer = setTimeout(() => processEvents(), debounceMs);
  }

  // Poll for new events
  setInterval(() => {
    try {
      const latestFile = path.join(EVENTS_DIR, 'latest-session');
      if (!fs.existsSync(latestFile)) return;

      const sessionId = fs.readFileSync(latestFile, 'utf8').trim();
      if (!sessionId) return;

      const eventFile = path.join(EVENTS_DIR, `${sessionId}.jsonl`);
      if (!fs.existsSync(eventFile)) return;

      if (eventFile !== lastEventFile) {
        lastEventFile = eventFile;
        fileOffset = 0;
      }

      const stat = fs.statSync(eventFile);
      if (stat.size <= fileOffset) return;

      const fd = fs.openSync(eventFile, 'r');
      const buf = Buffer.alloc(stat.size - fileOffset);
      fs.readSync(fd, buf, 0, buf.length, fileOffset);
      fs.closeSync(fd);
      fileOffset = stat.size;

      const newLines = buf.toString('utf8').trim().split('\n').filter(Boolean);
      const newEvents = newLines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      if (newEvents.length > 0) {
        eventBuffer.push(...newEvents);
        if (!isProcessing) {
          scheduleProcessing();
        }
      }
    } catch (err) {
      if (config.verbose) console.error('Poll error:', err.message);
    }
  }, 500);
}

module.exports = { startDaemon };
