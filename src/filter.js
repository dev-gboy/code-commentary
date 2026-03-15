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

module.exports = { deduplicateEvents };
