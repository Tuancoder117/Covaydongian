import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    optimizeDeps: {
        include: [
            'long',
            'seedrandom',
            '@tensorflow/tfjs',
            '@tensorflow/tfjs-backend-wasm',
            '@tensorflow/tfjs-backend-webgpu'
        ],
        exclude: ['katago-web']
    },
    build: {
        rollupOptions: {
            input: {
                home: resolve(root, 'index.html'),
                playWithAi: resolve(root, 'play-with-ai.html'),
                browserGo: resolve(root, 'playAI/playai.html')
            }
        }
    }
});
