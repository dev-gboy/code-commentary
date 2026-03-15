const WebSocket = require('ws');

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

class LiveSession {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.voice = config.voice || 'Puck';
    this.systemPrompt = config.systemPrompt;
    this.silent = config.silent || false;
    this.verbose = config.verbose || false;
    this.ws = null;
    this.onAudioChunk = null;
    this.onTurnComplete = null;
    this.onText = null;
    this.connected = false;
    this._reconnecting = false;
  }

  async connect() {
    const url = `${WS_URL}?key=${this.apiKey}`;
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-latest',
            generation_config: {
              response_modalities: this.silent ? ['TEXT'] : ['AUDIO'],
              temperature: 1.0,
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: { voice_name: this.voice }
                }
              }
            },
            system_instruction: {
              parts: [{ text: this.systemPrompt }]
            }
          }
        }));
      });

      this.ws.on('message', (data) => {
        const raw = data.toString();
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          if (this.verbose) console.error('\x1b[90m[WS] Failed to parse:', raw.slice(0, 200), '\x1b[0m');
          return;
        }

        if (msg.setupComplete) {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
          return;
        }

        // Audio chunks
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              this.onAudioChunk?.(part.inlineData.data);
            }
            if (part.text) {
              this.onText?.(part.text);
            }
          }
        }

        // Turn complete
        if (msg.serverContent?.turnComplete) {
          if (this.verbose) console.log('\x1b[90m[WS] Turn complete\x1b[0m');
          this.onTurnComplete?.();
        }

        // Log unhandled message types
        if (!msg.setupComplete && !msg.serverContent) {
          if (this.verbose) console.log('\x1b[90m[WS] Unhandled:', JSON.stringify(msg).slice(0, 300), '\x1b[0m');
        }
      });

      this.ws.on('error', (err) => {
        if (this.verbose) console.error('\x1b[90m[WS] Error:', err.message, '\x1b[0m');
        clearTimeout(timeout);
        this.connected = false;
        if (!this._reconnecting) reject(err);
      });

      this.ws.on('close', (code, reason) => {
        if (this.verbose) console.log(`\x1b[90m[WS] Closed: ${code} ${reason}\x1b[0m`);
        this.connected = false;
      });
    });
  }

  sendText(text) {
    if (!this.connected) {
      if (this.verbose) console.log('\x1b[90m[WS] Cannot send — not connected\x1b[0m');
      return false;
    }
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }]
        }],
        turnComplete: true
      }
    }));
    return true;
  }

  async reconnect() {
    this._reconnecting = true;
    this.disconnect();
    try {
      await this.connect();
    } finally {
      this._reconnecting = false;
    }
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
      this.connected = false;
    }
  }
}

module.exports = { LiveSession };
