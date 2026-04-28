// Run once: node download-model.js
// Downloads the Kokoro TTS model to ./models/ so the browser can load it locally.

import { KokoroTTS } from '@huggingface/transformers';
import { env } from '@huggingface/transformers';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(__dirname, 'models');
mkdirSync(modelsDir, { recursive: true });

// Tell transformers.js to cache into ./models/
env.cacheDir = modelsDir;

console.log('Downloading Kokoro-82M model to ./models/ ...');
console.log('This is a one-time ~82MB download.\n');

await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0', { dtype: 'q8' });

console.log('\nDone! Model saved to ./models/');
console.log('Start the game server with: python -m http.server 8080');
console.log('Then open: http://localhost:8080');
