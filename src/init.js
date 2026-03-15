const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const HOOK_EVENTS = {
  PostToolUse: { matcher: '*' },
  PostToolUseFailure: { matcher: '*' },
  Stop: {},
  Notification: {},
  SessionStart: {},
  SessionEnd: {},
};

function getBinPath() {
  const localBin = path.resolve(__dirname, '..', 'bin', 'code-commentary.js');
  if (fs.existsSync(localBin)) return `node ${localBin}`;
  return 'code-commentary';
}

function buildHooks() {
  const bin = getBinPath();
  const hooks = {};
  for (const [eventName, opts] of Object.entries(HOOK_EVENTS)) {
    const hookEntry = {
      type: 'command',
      command: `${bin} --hook-event ${eventName}`
    };
    const rule = { hooks: [hookEntry] };
    if (opts.matcher) rule.matcher = opts.matcher;
    hooks[eventName] = [rule];
  }
  return hooks;
}

function installHooks() {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
      console.error('Warning: Could not parse existing settings.json, creating fresh.');
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const newHooks = buildHooks();

  for (const [eventName, rules] of Object.entries(newHooks)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }

    // Remove any existing code-commentary hooks (may have stale paths)
    settings.hooks[eventName] = settings.hooks[eventName].filter(rule =>
      !rule.hooks?.some(h => h.command?.includes('code-commentary'))
    );

    // Add fresh hooks
    settings.hooks[eventName].push(...rules);
  }

  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    const msg = `Failed to write ${SETTINGS_PATH}: ${err.message}`;
    console.error(msg);
    return { success: false, message: msg };
  }

  console.log('Hooks installed into ~/.claude/settings.json');
  return { success: true, message: 'Hooks installed into ~/.claude/settings.json' };
}

function uninstallHooks() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { success: true, message: 'No settings.json found. Nothing to uninstall.' };
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return { success: false, message: `Could not parse ${SETTINGS_PATH}` };
  }

  if (!settings.hooks) {
    return { success: true, message: 'No hooks found. Nothing to uninstall.' };
  }

  let removed = false;
  for (const eventName of Object.keys(settings.hooks)) {
    const before = settings.hooks[eventName].length;
    settings.hooks[eventName] = settings.hooks[eventName].filter(rule =>
      !rule.hooks?.some(h => h.command?.includes('code-commentary'))
    );
    if (settings.hooks[eventName].length < before) removed = true;
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    const msg = `Failed to write ${SETTINGS_PATH}: ${err.message}`;
    console.error(msg);
    return { success: false, message: msg };
  }

  if (removed) {
    return { success: true, message: 'code-commentary hooks removed from ~/.claude/settings.json' };
  } else {
    return { success: true, message: 'No code-commentary hooks found to remove.' };
  }
}

function hooksInstalled() {
  if (!fs.existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (!settings.hooks) return false;
    return Object.values(settings.hooks).some(rules =>
      rules.some(rule => rule.hooks?.some(h => h.command?.includes('code-commentary')))
    );
  } catch {
    return false;
  }
}

module.exports = { installHooks, uninstallHooks, hooksInstalled };
