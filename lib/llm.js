'use strict';

let Ollama;
try {
  ({ Ollama } = require('ollama'));
} catch {
  Ollama = null;
}

async function chat({ text, model = 'llama3.2', systemPrompt = 'You are a helpful assistant.', host } = {}) {
  if (!Ollama) {
    return {
      error: 'ollama package is not installed. Install it with: npm install ollama'
    };
  }

  const options = {};
  if (host) options.host = host;

  try {
    const ollama = new Ollama(options);
    const result = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ]
    });

    return {
      response: result.message.content,
      model
    };
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
      return { error: 'Ollama is not running. Start it with: ollama serve' };
    }
    if (err.message && err.message.includes('not found')) {
      return { error: `Model "${model}" not found. Pull it with: ollama pull ${model}` };
    }
    return { error: `LLM error: ${err.message}` };
  }
}

module.exports = { chat };
