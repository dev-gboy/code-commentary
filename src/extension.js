const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');

let daemonProcess = null;
let outputChannel = null;
let statusBarItem = null;
let settingsProvider = null;

// --- Tree View Provider ---

class SettingsProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element) return [];

    const cfg = getConfig();
    const running = daemonProcess !== null;

    const items = [];

    // Status
    const status = new vscode.TreeItem(
      running ? 'Status: Running' : 'Status: Stopped',
      vscode.TreeItemCollapsibleState.None
    );
    status.iconPath = new vscode.ThemeIcon(running ? 'pass-filled' : 'circle-slash');
    status.description = running ? 'click stop to end' : 'click play to start';
    items.push(status);

    // Separator-ish
    const sep = new vscode.TreeItem('');
    items.push(sep);

    // Settings
    items.push(this._settingItem('Style', cfg.style, 'style', 'symbol-color'));
    items.push(this._settingItem('Voice', cfg.voice, 'voice', 'mic'));
    items.push(this._settingItem('Language', cfg.language || 'English', 'language', 'globe'));
    items.push(this._settingItem('Interval', `${cfg.interval}s`, 'interval', 'clock'));
    items.push(this._settingItem('Session TTL', cfg.sessionTtl > 0 ? `${cfg.sessionTtl} min` : 'disabled', 'sessionTtl', 'history'));
    items.push(this._settingItem('Silent Mode', cfg.silent ? 'On' : 'Off', 'silent', cfg.silent ? 'mute' : 'unmute'));
    items.push(this._settingItem('Verbose', cfg.verbose ? 'On' : 'Off', 'verbose', 'debug-console'));
    items.push(this._settingItem('API Key', cfg.apiKey ? 'configured' : 'not set', 'apiKey', 'key'));

    return items;
  }

  _settingItem(label, value, settingKey, icon) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = String(value);
    item.iconPath = new vscode.ThemeIcon(icon);
    item.contextValue = 'editable';
    item.command = {
      command: 'code-commentary.changeSetting',
      title: 'Change',
      arguments: [settingKey],
    };
    return item;
  }
}

// --- Setting change handlers ---

const SETTING_HANDLERS = {
  async style() {
    const styles = ['sports', 'podcast', 'nature', 'hype'];
    const descriptions = {
      sports: 'Excited sports commentator play-by-play',
      podcast: 'Chill, thoughtful podcast host',
      nature: 'David Attenborough nature documentary',
      hype: 'Maximum energy hype-person',
    };
    const picked = await vscode.window.showQuickPick(
      styles.map(s => ({ label: s, description: descriptions[s] })),
      { title: 'Commentary Style' }
    );
    if (picked) await updateSetting('style', picked.label);
  },

  async voice() {
    const voices = ['Puck', 'Kore', 'Charon', 'Aoede', 'Fenrir', 'Leda'];
    const descriptions = {
      Puck: 'Energetic, youthful',
      Kore: 'Clear, professional',
      Charon: 'Deep, authoritative',
      Aoede: 'Warm, expressive',
      Fenrir: 'Strong, bold',
      Leda: 'Calm, measured',
    };
    const picked = await vscode.window.showQuickPick(
      voices.map(v => ({ label: v, description: descriptions[v] })),
      { title: 'TTS Voice' }
    );
    if (picked) await updateSetting('voice', picked.label);
  },

  async language() {
    const value = await vscode.window.showInputBox({
      prompt: 'Commentary language (leave empty for English)',
      placeHolder: 'e.g. Spanish, Japanese, Hindi',
      value: getConfig().language,
    });
    if (value !== undefined) await updateSetting('language', value);
  },

  async interval() {
    const value = await vscode.window.showInputBox({
      prompt: 'Minimum seconds between commentary batches',
      value: String(getConfig().interval),
      validateInput: v => isNaN(parseInt(v)) || parseInt(v) < 1 ? 'Enter a number >= 1' : null,
    });
    if (value) await updateSetting('interval', parseInt(value));
  },

  async sessionTtl() {
    const value = await vscode.window.showInputBox({
      prompt: 'Session TTL in minutes (0 to disable)',
      value: String(getConfig().sessionTtl),
      validateInput: v => isNaN(parseInt(v)) || parseInt(v) < 0 ? 'Enter a number >= 0' : null,
    });
    if (value !== undefined) await updateSetting('sessionTtl', parseInt(value));
  },

  async silent() {
    const cfg = getConfig();
    await updateSetting('silent', !cfg.silent);
  },

  async verbose() {
    const cfg = getConfig();
    await updateSetting('verbose', !cfg.verbose);
  },

  async apiKey() {
    const value = await vscode.window.showInputBox({
      prompt: 'Google AI (Gemini) API key',
      password: true,
      ignoreFocusOut: true,
    });
    if (value !== undefined) await updateSetting('apiKey', value);
  },
};

async function updateSetting(key, value) {
  const cfg = vscode.workspace.getConfiguration('code-commentary');
  await cfg.update(key, value, vscode.ConfigurationTarget.Global);
  settingsProvider.refresh();
}

async function changeSetting(settingKey) {
  const handler = SETTING_HANDLERS[settingKey];
  if (handler) await handler();
}

// --- Core functions ---

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Code Commentary');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'code-commentary.toggle';
  setStatus('stopped');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Tree view
  settingsProvider = new SettingsProvider();
  const treeView = vscode.window.createTreeView('code-commentary.settings', {
    treeDataProvider: settingsProvider,
  });
  context.subscriptions.push(treeView);

  // Watch for config changes to refresh the tree
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('code-commentary')) {
        settingsProvider.refresh();
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('code-commentary.start', startDaemon),
    vscode.commands.registerCommand('code-commentary.stop', stopDaemon),
    vscode.commands.registerCommand('code-commentary.toggle', toggleDaemon),
    vscode.commands.registerCommand('code-commentary.changeSetting', changeSetting),
    vscode.commands.registerCommand('code-commentary.showOutput', () => outputChannel.show(true)),
  );
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('code-commentary');
  return {
    style: cfg.get('style', 'sports'),
    voice: cfg.get('voice', 'Puck'),
    interval: cfg.get('interval', 4),
    sessionTtl: cfg.get('sessionTtl', 30),
    silent: cfg.get('silent', false),
    verbose: cfg.get('verbose', false),
    language: cfg.get('language', ''),
    apiKey: cfg.get('apiKey', ''),
  };
}

function buildArgs(config) {
  const args = ['start'];
  args.push('--style', config.style);
  args.push('--voice', config.voice);
  args.push('--interval', String(config.interval));
  args.push('--session-ttl', String(config.sessionTtl));
  if (config.silent) args.push('--silent');
  if (config.verbose) args.push('--verbose');
  if (config.language) args.push('--language', config.language);
  if (config.apiKey) args.push('--api-key', config.apiKey);
  return args;
}

async function startDaemon() {
  if (daemonProcess) {
    vscode.window.showWarningMessage('Code Commentary is already running.');
    return;
  }

  const config = getConfig();

  if (!config.apiKey && !process.env.GEMINI_API_KEY) {
    const key = await vscode.window.showInputBox({
      prompt: 'Enter your Google AI (Gemini) API key',
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) return;
    config.apiKey = key;
  }

  const cliPath = path.join(__dirname, '..', 'bin', 'code-commentary.js');
  const args = buildArgs(config);

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine(`Starting code-commentary: ${config.style} style, ${config.voice} voice`);

  daemonProcess = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      ...(config.apiKey ? { GEMINI_API_KEY: config.apiKey } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  daemonProcess.stdout.on('data', (data) => {
    outputChannel.appendLine(stripAnsi(data.toString().trimEnd()));
  });

  daemonProcess.stderr.on('data', (data) => {
    outputChannel.appendLine(stripAnsi(data.toString().trimEnd()));
  });

  daemonProcess.on('error', (err) => {
    outputChannel.appendLine(`Error: ${err.message}`);
    cleanup();
  });

  daemonProcess.on('close', (code) => {
    if (code !== null && code !== 0) {
      outputChannel.appendLine(`Daemon exited with code ${code}`);
    }
    cleanup();
  });

  setStatus('running');
}

function stopDaemon() {
  if (!daemonProcess) {
    vscode.window.showInformationMessage('Code Commentary is not running.');
    return;
  }

  daemonProcess.kill('SIGTERM');
  outputChannel.appendLine('Stopping code-commentary...');
}

function toggleDaemon() {
  if (daemonProcess) {
    stopDaemon();
  } else {
    startDaemon();
  }
}

function cleanup() {
  daemonProcess = null;
  setStatus('stopped');
}

function setStatus(state) {
  const running = state === 'running';
  vscode.commands.executeCommand('setContext', 'code-commentary.running', running);

  if (statusBarItem) {
    if (running) {
      statusBarItem.text = '$(megaphone) Commentary: ON';
      statusBarItem.tooltip = 'Code Commentary is running. Click to stop.';
    } else {
      statusBarItem.text = '$(megaphone) Commentary: OFF';
      statusBarItem.tooltip = 'Code Commentary is stopped. Click to start.';
    }
  }

  if (settingsProvider) {
    settingsProvider.refresh();
  }
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function deactivate() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
  }
}

module.exports = { activate, deactivate };
