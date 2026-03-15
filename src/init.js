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

function buildHooks() {
  const hooks = {};
  for (const [eventName, opts] of Object.entries(HOOK_EVENTS)) {
    const hookEntry = {
      type: 'command',
      command: `code-commentary --hook-event ${eventName}`
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
  let alreadyInstalled = true;

  for (const [eventName, rules] of Object.entries(newHooks)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }

    // Check if our hook already exists
    const existing = settings.hooks[eventName];
    const hasOurs = existing.some(rule =>
      rule.hooks?.some(h => h.command?.startsWith('code-commentary'))
    );

    if (!hasOurs) {
      alreadyInstalled = false;
      settings.hooks[eventName].push(...rules);
    }
  }

  if (alreadyInstalled) {
    console.log('code-commentary hooks are already installed.');
    return;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  console.log('Hooks installed into ~/.claude/settings.json');
  console.log('Now run: code-commentary start');
}

function uninstallHooks() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log('No settings.json found. Nothing to uninstall.');
    return;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    console.error('Could not parse settings.json');
    return;
  }

  if (!settings.hooks) {
    console.log('No hooks found. Nothing to uninstall.');
    return;
  }

  let removed = false;
  for (const eventName of Object.keys(settings.hooks)) {
    const before = settings.hooks[eventName].length;
    settings.hooks[eventName] = settings.hooks[eventName].filter(rule =>
      !rule.hooks?.some(h => h.command?.startsWith('code-commentary'))
    );
    if (settings.hooks[eventName].length < before) removed = true;
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');

  if (removed) {
    console.log('code-commentary hooks removed from ~/.claude/settings.json');
  } else {
    console.log('No code-commentary hooks found to remove.');
  }
}

module.exports = { installHooks, uninstallHooks };
