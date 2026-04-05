'use strict';

let Ollama;
try {
  ({ Ollama } = require('ollama'));
} catch {
  Ollama = null;
}

const REQUEST_TIMEOUT_MS = 60000;

function isConnectionError(err) {
  const codes = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT'];
  if (err.code && codes.includes(err.code)) return true;
  if (err.cause) return isConnectionError(err.cause);
  if (err.message && /connect|refused|unreachable/i.test(err.message)) return true;
  return false;
}

async function chat({ text, model = 'llama3.2', systemPrompt = 'You are a helpful assistant.', host } = {}) {
  if (!Ollama) {
    return {
      error: 'ollama package is not installed. Install it with: npm install ollama'
    };
  }

  const options = {};
  if (host) options.host = host;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const ollama = new Ollama(options);
    const result = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      signal: controller.signal
    });

    return {
      response: result.message.content,
      model
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: `Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.` };
    }
    if (isConnectionError(err)) {
      return { error: 'Ollama is not running. Start it with: ollama serve' };
    }
    if (err.message && err.message.includes('not found')) {
      return { error: `Model "${model}" not found. Pull it with: ollama pull ${model}` };
    }
    return { error: `LLM error: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { chat };
