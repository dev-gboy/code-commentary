const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { installHooks, uninstallHooks, hooksInstalled } = require('./init');
const pkg = require('../package.json');

let daemonProcess = null;
let outputChannel = null;
let statusBarItem = null;
let sidebarProvider = null;

// --- Sidebar WebviewView Provider (settings + audio player) ---

class SidebarProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this._updateHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'start': startDaemon(); break;
        case 'stop': stopDaemon(); break;
        case 'showOutput': outputChannel.show(true); break;
        case 'changeSetting': changeSetting(msg.key); break;
        case 'installHooks': doInstallHooks(); break;
        case 'uninstallHooks': doUninstallHooks(); break;
      }
    });

    webviewView.onDidDispose(() => { this._view = null; });
  }

  postAudioMessage(msg) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }

  refresh() {
    if (this._view) this._updateHtml();
  }

  _updateHtml() {
    if (!this._view) return;
    const cfg = getConfig();
    const running = daemonProcess !== null;
    const hooks = hooksInstalled();

    this._view.webview.html = /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px; margin: 0; }
  .row { display: flex; align-items: center; padding: 4px 0; cursor: pointer; border-radius: 3px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .icon { width: 20px; text-align: center; margin-right: 8px; flex-shrink: 0; }
  .label { flex: 1; }
  .value { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .status { font-weight: bold; padding: 6px 0; }
  .separator { height: 1px; background: var(--vscode-widget-border); margin: 6px 0; }
  .btn { display: inline-block; padding: 4px 12px; border-radius: 3px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); margin: 4px 4px 4px 0; font-size: 0.9em; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .actions { padding: 8px 0; }
</style>
</head>
<body>

<div class="status">
  <span class="icon">${running ? '\u2705' : '\u26d4'}</span>
  Status: ${running ? 'Running' : 'Stopped'}
</div>

<div class="actions">
  ${running
    ? '<span class="btn btn-secondary" onclick="send(\'stop\')">Stop</span>'
    : '<span class="btn btn-primary" onclick="send(\'start\')">Start</span>'
  }
  <span class="btn btn-secondary" onclick="send('showOutput')">Output</span>
</div>

<div class="separator"></div>

<div class="row" onclick="send('changeSetting', 'style')">
  <span class="label">Style</span>
  <span class="value">${cfg.style}</span>
</div>
<div class="row" onclick="send('changeSetting', 'voice')">
  <span class="label">Voice</span>
  <span class="value">${cfg.voice}</span>
</div>
<div class="row" onclick="send('changeSetting', 'language')">
  <span class="label">Language</span>
  <span class="value">${cfg.language || 'English'}</span>
</div>
<div class="row" onclick="send('changeSetting', 'interval')">
  <span class="label">Interval</span>
  <span class="value">${cfg.interval}s</span>
</div>
<div class="row" onclick="send('changeSetting', 'sessionTtl')">
  <span class="label">Session TTL</span>
  <span class="value">${cfg.sessionTtl > 0 ? cfg.sessionTtl + ' min' : 'disabled'}</span>
</div>
<div class="row" onclick="send('changeSetting', 'silent')">
  <span class="label">Silent Mode</span>
  <span class="value">${cfg.silent ? 'On' : 'Off'}</span>
</div>
<div class="row" onclick="send('changeSetting', 'verbose')">
  <span class="label">Verbose</span>
  <span class="value">${cfg.verbose ? 'On' : 'Off'}</span>
</div>
<div class="row" onclick="send('changeSetting', 'apiKey')">
  <span class="label">API Key</span>
  <span class="value">${cfg.apiKey ? 'configured' : 'not set'}</span>
</div>

<div class="separator"></div>

<div class="row" onclick="send('${hooks ? 'uninstallHooks' : 'installHooks'}')">
  <span class="icon">${hooks ? '\u2705' : '\ud83d\udd0c'}</span>
  <span class="label">Claude Hooks</span>
  <span class="value">${hooks ? 'installed' : 'not installed'}</span>
</div>

<div class="separator"></div>
<div id="audio-debug" style="font-size: 0.8em; color: var(--vscode-descriptionForeground); padding: 4px 0;">Audio: waiting...</div>

<script>
const vscode = acquireVsCodeApi();

function send(command, key) {
  vscode.postMessage({ command, key });
}

// --- Web Audio API player (runs on UI/host side) ---
const SAMPLE_RATE = 24000;
let audioCtx = null;
let nextStartTime = 0;

function ensureContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    nextStartTime = audioCtx.currentTime;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Pre-init AudioContext on any user gesture to satisfy autoplay policy
document.addEventListener('click', () => {
  ensureContext();
}, { once: false });

function playPcmChunk(base64Data) {
  const ctx = ensureContext();
  const raw = atob(base64Data);
  const samples = raw.length / 2;
  const buffer = ctx.createBuffer(1, samples, SAMPLE_RATE);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < samples; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    let sample = lo | (hi << 8);
    if (sample >= 0x8000) sample -= 0x10000;
    channel[i] = sample / 32768;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  const now = ctx.currentTime;
  if (nextStartTime < now) nextStartTime = now;
  source.start(nextStartTime);
  nextStartTime += buffer.duration;
}

let audioChunkCount = 0;
const dbg = document.getElementById('audio-debug');

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'audio') {
    audioChunkCount++;
    try {
      playPcmChunk(msg.data);
      if (dbg) dbg.textContent = 'Audio chunks: ' + audioChunkCount + ' | ctx state: ' + (audioCtx ? audioCtx.state : 'none');
    } catch (e) {
      if (dbg) dbg.textContent = 'Audio ERROR: ' + e.message;
    }
  } else if (msg.type === 'end_utterance') {
    nextStartTime = 0;
  }
});
</script>

</body>
</html>`;
  }
}

// --- Setting change handlers ---

const SETTING_HANDLERS = {
  async style() {
    const styles = ['sports', 'podcast', 'nature', 'hype', 'narrator', 'coding-buddy'];
    const descriptions = {
      sports: 'Excited sports commentator play-by-play',
      podcast: 'Chill, thoughtful podcast host',
      nature: 'David Attenborough nature documentary',
      hype: 'Maximum energy hype-person',
      narrator: 'Clear, informational narration',
      'coding-buddy': 'Smart colleague giving status updates',
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
  if (sidebarProvider) sidebarProvider.refresh();
}

async function changeSetting(settingKey) {
  const handler = SETTING_HANDLERS[settingKey];
  if (handler) await handler();
}

async function doInstallHooks() {
  const result = installHooks();
  if (result.success) {
    vscode.window.showInformationMessage(result.message);
  } else {
    vscode.window.showErrorMessage(result.message);
  }
  if (sidebarProvider) sidebarProvider.refresh();
}

async function doUninstallHooks() {
  const confirm = await vscode.window.showWarningMessage(
    'Remove Code Commentary hooks from ~/.claude/settings.json?',
    { modal: true },
    'Uninstall'
  );
  if (confirm !== 'Uninstall') return;
  const result = uninstallHooks();
  if (result.success) {
    vscode.window.showInformationMessage(result.message);
  } else {
    vscode.window.showErrorMessage(result.message);
  }
  if (sidebarProvider) sidebarProvider.refresh();
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

  // Sidebar webview (settings + audio)
  sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('code-commentary.settings', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Watch for config changes to refresh sidebar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('code-commentary')) {
        if (sidebarProvider) sidebarProvider.refresh();
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
    vscode.commands.registerCommand('code-commentary.installHooks', doInstallHooks),
    vscode.commands.registerCommand('code-commentary.uninstallHooks', doUninstallHooks),
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
  const args = ['start', '--json-output'];
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
  outputChannel.appendLine(`code-commentary v${pkg.version}`);
  outputChannel.appendLine(`Starting: ${config.style} style, ${config.voice} voice`);

  daemonProcess = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      ...(config.apiKey ? { GEMINI_API_KEY: config.apiKey } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // stdout carries JSON lines (audio chunks, text, end_utterance)
  let stdoutBuf = '';
  daemonProcess.stdout.on('data', (data) => {
    stdoutBuf += data.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'audio' && sidebarProvider) {
          sidebarProvider.postAudioMessage({ type: 'audio', data: msg.data });
        } else if (msg.type === 'end_utterance' && sidebarProvider) {
          sidebarProvider.postAudioMessage({ type: 'end_utterance' });
        } else if (msg.type === 'text') {
          outputChannel.appendLine(`Commentary: ${msg.data}`);
        }
      } catch {
        outputChannel.appendLine(stripAnsi(line));
      }
    }
  });

  // stderr carries log/status messages
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

  if (sidebarProvider) {
    sidebarProvider.refresh();
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
