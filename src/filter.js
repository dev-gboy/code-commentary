// Deduplicate rapid-fire identical events (same tool + same file within 2s)
function deduplicateEvents(events) {
  const seen = new Map();
  return events.filter(e => {
    if (!e.tool || !e.input?.file_path) return true;
    const key = `${e.tool}:${e.input.file_path}`;
    const prev = seen.get(key);
    if (prev && (e.timestamp - prev.timestamp) < 2000) {
      seen.set(key, e);
      return false;
    }
    seen.set(key, e);
    return true;
  });
}

// Aggressive filter for coding-buddy: only keep events worth reporting
function filterForCodingBuddy(events) {
  const deduped = deduplicateEvents(events);
  return deduped.filter(e => {
    // Always keep: session boundaries, errors, notifications, user prompts, stops
    const keepEvents = ['SessionStart', 'SessionEnd', 'Notification', 'PostToolUseFailure', 'Stop', 'UserPromptSubmit'];
    if (keepEvents.includes(e.event)) return true;

    // Keep: Bash commands (real actions with exit codes)
    if (e.event === 'PostToolUse' && e.tool === 'Bash') return true;

    // Keep: Write (new file creation is significant)
    if (e.event === 'PostToolUse' && e.tool === 'Write') return true;

    // Drop: Read, Grep, Glob, Edit — noise for coding-buddy
    return false;
  });
}

module.exports = { deduplicateEvents, filterForCodingBuddy };
