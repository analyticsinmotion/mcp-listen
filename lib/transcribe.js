'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let whisper;
try {
  whisper = require('@kutalia/whisper-node-addon');
} catch {
  whisper = null;
}

const DEFAULT_MODEL = 'ggml-base.en.bin';

function resolveModelPath(modelPath) {
  // If absolute path provided, use it directly
  if (modelPath && path.isAbsolute(modelPath)) {
    return fs.existsSync(modelPath) ? modelPath : null;
  }

  const modelName = modelPath || DEFAULT_MODEL;
  const searchPaths = [];

  // 1. WHISPER_MODEL_PATH env var
  if (process.env.WHISPER_MODEL_PATH) {
    searchPaths.push(path.join(process.env.WHISPER_MODEL_PATH, modelName));
  }

  // 2. ~/.mcp-listen/models/
  searchPaths.push(path.join(os.homedir(), '.mcp-listen', 'models', modelName));

  // 3. Current working directory
  searchPaths.push(path.join(process.cwd(), modelName));

  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

async function transcribe({ filePath, modelPath, language = 'en' } = {}) {
  if (!whisper) {
    return {
      error: '@kutalia/whisper-node-addon is not installed. Install it with: npm install @kutalia/whisper-node-addon'
    };
  }

  const resolvedModel = resolveModelPath(modelPath);
  if (!resolvedModel) {
    const modelName = modelPath || DEFAULT_MODEL;
    const modelsDir = path.join(os.homedir(), '.mcp-listen', 'models');
    return {
      error: `Whisper model "${modelName}" not found. Download it:\n` +
        `  mkdir -p ${modelsDir}\n` +
        `  curl -L -o ${path.join(modelsDir, modelName)} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`
    };
  }

  try {
    const result = await whisper.transcribe({
      fname_inp: filePath,
      model: resolvedModel,
      language
    });

    if (!result || !Array.isArray(result.transcription)) {
      return { error: 'Unexpected whisper response format. Expected { transcription: [] }.' };
    }

    const text = result.transcription
      .map(segment => {
        if (typeof segment === 'string') return segment;
        if (Array.isArray(segment) && typeof segment[2] === 'string') return segment[2];
        return '';
      })
      .join(' ')
      .trim();

    return { transcription: text };
  } catch (err) {
    return { error: `Transcription failed: ${err.message}` };
  }
}

module.exports = { transcribe };
