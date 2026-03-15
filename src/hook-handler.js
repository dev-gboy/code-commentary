const fs = require('fs');
const path = require('path');
const { EVENTS_DIR } = require('./config');

function handleHookEvent(hookEventName) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const sessionId = event.session_id;

      if (!sessionId) {
        process.exit(0);
        return;
      }

      fs.mkdirSync(EVENTS_DIR, { recursive: true });

      const line = JSON.stringify({
        timestamp: Date.now(),
        event: hookEventName,
        tool: event.tool_name || null,
        input: summarizeInput(event),
        response: summarizeResponse(event),
        error: event.error || null,
        message: event.notification || event.message || null,
        session_id: sessionId,
        cwd: event.cwd
      }) + '\n';

      fs.appendFileSync(path.join(EVENTS_DIR, `${sessionId}.jsonl`), line);
      fs.writeFileSync(path.join(EVENTS_DIR, 'latest-session'), sessionId);
    } catch (err) {
      // Silently fail — never interfere with Claude Code
    }

    process.exit(0);
  });
}

function summarizeInput(event) {
  if (!event.tool_input) return null;
  const ti = event.tool_input;
  if (ti.file_path) return { file_path: ti.file_path };
  if (ti.command) return { command: ti.command, description: ti.description };
  return ti;
}

function summarizeResponse(event) {
  if (!event.tool_response) return null;
  const tr = event.tool_response;
  if (typeof tr === 'string' && tr.length > 500) {
    return tr.slice(0, 250) + '...[truncated]...' + tr.slice(-250);
  }
  if (tr.stdout && tr.stdout.length > 500) {
    return { ...tr, stdout: tr.stdout.slice(0, 500) + '...[truncated]' };
  }
  return tr;
}

module.exports = { handleHookEvent };
