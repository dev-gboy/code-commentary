const path = require('path');
const os = require('os');

const DEFAULTS = {
  style: 'sports',
  voice: 'Puck',
  interval: 4,
  sessionTtl: 30,
  silent: false,
  verbose: false,
  background: false,
  jsonOutput: false,
  apiKey: null,
  language: null,
};

const VALID_STYLES = ['sports', 'podcast', 'nature', 'hype', 'narrator', 'coding-buddy'];
const VALID_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'];

function parseArgs(args) {
  const config = { ...DEFAULTS };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--style':
        config.style = args[++i];
        break;
      case '--voice':
        config.voice = args[++i];
        break;
      case '--interval':
        config.interval = parseInt(args[++i], 10);
        break;
      case '--session-ttl':
        config.sessionTtl = parseInt(args[++i], 10);
        break;
      case '--silent':
        config.silent = true;
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--background':
        config.background = true;
        break;
      case '--json-output':
        config.jsonOutput = true;
        break;
      case '--api-key':
        config.apiKey = args[++i];
        break;
      case '--language':
        config.language = args[++i];
        break;
    }
    i++;
  }

  config.apiKey = config.apiKey || process.env.GEMINI_API_KEY;

  if (!VALID_STYLES.includes(config.style)) {
    console.error(`Invalid style: ${config.style}. Valid: ${VALID_STYLES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_VOICES.includes(config.voice)) {
    console.error(`Invalid voice: ${config.voice}. Valid: ${VALID_VOICES.join(', ')}`);
    process.exit(1);
  }

  return config;
}

const EVENTS_DIR = path.join(os.tmpdir(), 'code-buddy');
const PID_FILE = path.join(os.tmpdir(), 'code-buddy.pid');

module.exports = { parseArgs, DEFAULTS, VALID_STYLES, VALID_VOICES, EVENTS_DIR, PID_FILE };
