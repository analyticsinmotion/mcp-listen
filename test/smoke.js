'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { version } = require('../package.json');

const SERVER_PATH = path.join(__dirname, '..', 'index.js');
const STARTUP_DELAY = 1000;
const RESPONSE_TIMEOUT = 15000;

let passed = 0;
let failed = 0;
let skipped = 0;
let msgId = 0;

function log(status, name) {
  const symbol = status === 'pass' ? '\x1b[32mPASS\x1b[0m' : status === 'fail' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mSKIP\x1b[0m';
  console.log(`  ${symbol}  ${name}`);
}

function startServer() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let buffer = '';
  const pending = new Map();

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    }
  });

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, RESPONSE_TIMEOUT);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  function kill() {
    child.kill();
  }

  return { send, notify, kill, child };
}

async function run() {
  console.log('\nmcp-listen smoke tests\n');

  const server = startServer();
  await new Promise(r => setTimeout(r, STARTUP_DELAY));

  // Test 1: Server initializes
  try {
    const res = await server.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0' }
    });
    server.notify('notifications/initialized');

    const info = res.result.serverInfo;
    if (info.name !== 'mcp-listen') throw new Error(`Expected name 'mcp-listen', got '${info.name}'`);
    if (info.version !== version) throw new Error(`Expected version '${version}', got '${info.version}'`);
    log('pass', `Server initializes (${info.name} v${info.version})`);
    passed++;
  } catch (err) {
    log('fail', `Server initializes: ${err.message}`);
    failed++;
    server.kill();
    return;
  }

  // Test 2: All 3 tools advertised
  try {
    const res = await server.send('tools/list', {});
    const names = res.result.tools.map(t => t.name).sort();
    const expected = ['capture_audio', 'list_audio_devices', 'voice_query'];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`Expected tools ${expected}, got ${names}`);
    }
    log('pass', 'All 3 tools advertised');
    passed++;
  } catch (err) {
    log('fail', `All 3 tools advertised: ${err.message}`);
    failed++;
  }

  // Test 3: list_audio_devices returns valid response
  let hasDevices = false;
  try {
    const res = await server.send('tools/call', { name: 'list_audio_devices', arguments: {} });
    const text = res.result.content[0].text;
    const parsed = JSON.parse(text);

    if (parsed.devices && parsed.devices.length === 0) {
      hasDevices = false;
      log('pass', 'list_audio_devices returns empty (no mic detected)');
    } else if (Array.isArray(parsed)) {
      hasDevices = parsed.length > 0;
      if (hasDevices && typeof parsed[0].name !== 'string') {
        throw new Error('Device object missing name field');
      }
      log('pass', `list_audio_devices returns ${parsed.length} device(s)`);
    } else {
      throw new Error('Unexpected response format');
    }
    passed++;
  } catch (err) {
    log('fail', `list_audio_devices: ${err.message}`);
    failed++;
  }

  // Test 4: capture_audio produces WAV file (requires mic)
  if (hasDevices) {
    try {
      const res = await server.send('tools/call', {
        name: 'capture_audio',
        arguments: { duration_ms: 500 }
      });
      if (res.result.isError) throw new Error(res.result.content[0].text);
      const data = JSON.parse(res.result.content[0].text);
      if (!data.path) throw new Error('No path in response');
      if (!fs.existsSync(data.path)) throw new Error(`File not found: ${data.path}`);

      const header = Buffer.alloc(4);
      const fd = fs.openSync(data.path, 'r');
      fs.readSync(fd, header, 0, 4, 0);
      fs.closeSync(fd);
      if (header.toString('ascii') !== 'RIFF') throw new Error('File does not start with RIFF header');

      const stat = fs.statSync(data.path);
      if (stat.size <= 44) throw new Error('WAV file contains no audio data');

      // Clean up test file
      try { fs.unlinkSync(data.path); } catch {}

      log('pass', `capture_audio produces valid WAV (${stat.size} bytes)`);
      passed++;
    } catch (err) {
      log('fail', `capture_audio: ${err.message}`);
      failed++;
    }
  } else {
    log('skip', 'capture_audio (no microphone available)');
    skipped++;
  }

  // Test 5: capture_audio rejects invalid device
  try {
    const res = await server.send('tools/call', {
      name: 'capture_audio',
      arguments: { device: 99999 }
    });
    if (!res.result.isError) throw new Error('Expected isError: true for invalid device');
    log('pass', 'capture_audio rejects invalid device');
    passed++;
  } catch (err) {
    log('fail', `capture_audio invalid device: ${err.message}`);
    failed++;
  }

  // Test 6: Unknown tool returns error
  try {
    const res = await server.send('tools/call', {
      name: 'nonexistent_tool',
      arguments: {}
    });
    if (!res.result.isError) throw new Error('Expected isError: true for unknown tool');
    log('pass', 'Unknown tool returns error');
    passed++;
  } catch (err) {
    log('fail', `Unknown tool: ${err.message}`);
    failed++;
  }

  server.kill();

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
