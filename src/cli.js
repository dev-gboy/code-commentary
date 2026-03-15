const fs = require('fs');
const { parseArgs, PID_FILE } = require('./config');
const { installHooks, uninstallHooks } = require('./init');
const { handleHookEvent } = require('./hook-handler');
const { startDaemon } = require('./daemon');

const args = process.argv.slice(2);

// Hook event mode (called by Claude Code hooks)
const hookIdx = args.indexOf('--hook-event');
if (hookIdx !== -1) {
  const eventName = args[hookIdx + 1];
  if (!eventName) {
    process.exit(1);
  }
  handleHookEvent(eventName);
} else {
  // CLI command mode
  const command = args[0];

  switch (command) {
    case 'init':
      installHooks();
      break;

    case 'start': {
      const config = parseArgs(args.slice(1));

      if (config.background) {
        // Daemonize
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, [__filename, 'start', ...args.slice(1).filter(a => a !== '--background')], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        fs.writeFileSync(PID_FILE, String(child.pid));
        console.log(`code-buddy daemon started (PID: ${child.pid})`);
        console.log(`Stop with: code-buddy stop`);
        process.exit(0);
      }

      startDaemon(config);
      break;
    }

    case 'stop': {
      if (!fs.existsSync(PID_FILE)) {
        console.log('No running daemon found.');
        break;
      }
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Stopped code-buddy daemon (PID: ${pid})`);
      } catch (err) {
        if (err.code === 'ESRCH') {
          console.log('Daemon was not running.');
        } else {
          console.error(`Failed to stop daemon: ${err.message}`);
        }
      }
      try { fs.unlinkSync(PID_FILE); } catch {}
      break;
    }

    case 'uninstall':
      uninstallHooks();
      break;

    default:
      console.log(`code-buddy - Live audio commentary for AI coding sessions

Usage:
  code-buddy init                Install hooks into Claude Code
  code-buddy start [options]     Start the commentary daemon
  code-buddy stop                Stop the background daemon
  code-buddy uninstall           Remove hooks from Claude Code

Start options:
  --style <name>       Commentary style: sports | podcast | nature | hype | narrator | coding-buddy  [default: sports]
  --voice <name>       TTS voice: Puck | Kore | Charon | Aoede | Fenrir   [default: Puck]
  --interval <sec>     Min seconds between commentary batches              [default: 4]
  --session-ttl <min>  Reconnect after N minutes (reset context)           [default: 30]
  --silent             Text-only mode (no audio)
  --verbose            Print raw events alongside commentary
  --background         Run as background daemon
  --language <lang>    Commentary language (e.g. Spanish, Japanese, Hindi)
  --api-key <key>      Google AI API key (or set GEMINI_API_KEY env var)`);
      break;
  }
}
