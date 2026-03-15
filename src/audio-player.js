const { spawn } = require('child_process');

class StreamingPlayer {
  constructor() {
    this.current = null;    // current ffplay process
    this.playQueue = [];    // queue of pending utterances
    this.draining = false;  // waiting for current to finish
  }

  // Start a new ffplay for this utterance
  _spawnPlayer() {
    const proc = spawn('ffplay', [
      '-nodisp', '-autoexit', '-loglevel', 'quiet',
      '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono',
      '-i', 'pipe:0'
    ], {
      stdio: ['pipe', 'ignore', 'ignore']
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('ffplay not found. Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
      }
    });

    return proc;
  }

  // Feed audio chunk to current utterance
  feedChunk(base64Data) {
    if (!this.current) {
      this.current = this._spawnPlayer();
    }
    const buffer = Buffer.from(base64Data, 'base64');
    if (this.current && !this.current.stdin.destroyed) {
      this.current.stdin.write(buffer);
    }
  }

  // End current utterance — close stdin so ffplay plays remaining buffer,
  // then wait for it to finish before resolving
  endUtterance() {
    return new Promise((resolve) => {
      const proc = this.current;
      this.current = null;

      if (!proc || proc.killed) {
        resolve();
        return;
      }

      if (!proc.stdin.destroyed) {
        proc.stdin.end();
      }

      proc.on('close', () => {
        resolve();
      });
    });
  }

  kill() {
    if (this.current && !this.current.killed) {
      this.current.kill();
      this.current = null;
    }
  }
}

module.exports = { StreamingPlayer };
