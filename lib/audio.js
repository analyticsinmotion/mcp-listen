'use strict';

const Decibri = require('decibri');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createWavBuffer } = require('./wav');

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BIT_DEPTH = 16;
const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 30000;
const SAFETY_MARGIN_MS = 2000;

let activeMic = null;

function getActiveMic() {
  return activeMic;
}

function listDevices() {
  try {
    const devices = Decibri.devices();
    if (devices.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ devices: [], message: 'No audio input devices found. Connect a microphone and try again.' }, null, 2) }]
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(devices, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error listing audio devices: ${err.message}` }],
      isError: true
    };
  }
}

function captureAudio({ durationMs = 5000, device, outputPath } = {}) {
  return new Promise((resolve) => {
    // Validate duration
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return resolve({
        content: [{ type: 'text', text: `Error: duration_ms must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}. Got: ${durationMs}` }],
        isError: true
      });
    }

    // Reject concurrent captures
    if (activeMic && activeMic.isOpen) {
      return resolve({
        content: [{ type: 'text', text: 'Error: Recording already in progress. Wait for the current recording to finish.' }],
        isError: true
      });
    }

    // Build mic options
    const micOptions = { sampleRate: SAMPLE_RATE, channels: CHANNELS };
    if (device !== undefined) micOptions.device = device;

    // Create microphone (throws synchronously if device invalid or no mic)
    let mic;
    try {
      mic = new Decibri(micOptions);
    } catch (err) {
      return resolve({
        content: [{ type: 'text', text: `Error opening microphone: ${err.message}` }],
        isError: true
      });
    }

    activeMic = mic;
    const chunks = [];
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      activeMic = null;
      clearTimeout(recordTimer);
      clearTimeout(safetyTimer);
      resolve(result);
    }

    mic.on('data', (chunk) => {
      chunks.push(chunk);
    });

    mic.on('error', (err) => {
      if (mic.isOpen) mic.stop();
      finish({
        content: [{ type: 'text', text: `Microphone error during recording: ${err.message}` }],
        isError: true
      });
    });

    mic.on('end', () => {
      const pcm = Buffer.concat(chunks);
      const wav = createWavBuffer(pcm, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
      const filepath = outputPath || path.join(os.tmpdir(), `mcp-listen-${Date.now()}.wav`);

      try {
        fs.writeFileSync(filepath, wav);
      } catch (err) {
        return finish({
          content: [{ type: 'text', text: `Error writing WAV file: ${err.message}` }],
          isError: true
        });
      }

      finish({
        content: [{
          type: 'text',
          text: JSON.stringify({
            path: filepath,
            duration_ms: durationMs,
            sample_rate: SAMPLE_RATE,
            channels: CHANNELS,
            size_bytes: wav.length
          }, null, 2)
        }]
      });
    });

    // Stop recording after duration
    const recordTimer = setTimeout(() => {
      if (mic.isOpen) mic.stop();
    }, durationMs);

    // Safety timeout in case 'end' never fires
    const safetyTimer = setTimeout(() => {
      if (mic.isOpen) mic.stop();
      finish({
        content: [{ type: 'text', text: 'Error: Recording timed out. The microphone did not stop cleanly.' }],
        isError: true
      });
    }, durationMs + SAFETY_MARGIN_MS);
  });
}

module.exports = { listDevices, captureAudio, getActiveMic };
