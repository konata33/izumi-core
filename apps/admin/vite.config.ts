import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid development port: ${value}`);
  }
  return port;
}

export default defineConfig(({ mode }) => {
  // The root .env is also Core's configuration source. Reading it here keeps
  // manual API/Admin port changes in one place without exposing its secrets.
  const environment = loadEnv(mode, workspaceRoot, '');
  const conductorPort = process.env.CONDUCTOR_PORT;
  const corePort = readPort(conductorPort, readPort(environment.PORT, 3001));
  const adminPort =
    conductorPort === undefined ? readPort(environment.ADMIN_PORT, 5173) : corePort + 1;

  if (adminPort > 65_535) {
    throw new Error(
      `The Admin port derived from CONDUCTOR_PORT is invalid: ${adminPort}`,
    );
  }

  return {
    base: '/admin/',
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          onlyExplicitManualChunks: true,
          manualChunks(id) {
            if (id.includes('/src/components/rich-post-preview-extension-ai.ts')) {
              return 'haklex-preview-ai-chat';
            }
            if (id.includes('/src/components/rich-post-preview-extension-canvas.ts')) {
              return 'haklex-preview-excalidraw';
            }
            if (id.includes('/src/components/rich-post-preview-extension-code.ts')) {
              return 'haklex-preview-code';
            }
            if (id.includes('/src/components/rich-post-preview-extension-diagram.ts')) {
              return 'haklex-preview-diagram';
            }
            if (id.includes('/src/components/rich-post-preview-extension-light.ts')) {
              return 'haklex-preview-light';
            }
            if (
              id.includes('/src/components/rich-post-extension-canvas.tsx') ||
              id.includes('/node_modules/@haklex/rich-ext-excalidraw/') ||
              id.includes('/node_modules/@excalidraw/')
            ) {
              return 'haklex-excalidraw';
            }
            if (
              id.includes('/src/components/rich-post-extension-ai.ts') ||
              id.includes('/node_modules/@haklex/rich-ext-chat/') ||
              id.includes('/node_modules/@haklex/rich-ext-ai-agent/')
            ) {
              return 'haklex-ai-chat';
            }
            if (
              id.includes('/src/components/rich-post-extension-code.ts') ||
              id.includes('/node_modules/@haklex/rich-ext-code-snippet/')
            ) {
              return 'haklex-code';
            }
            if (
              id.includes('/src/components/rich-post-extension-light.tsx') ||
              id.includes('/src/components/post-reference-node.tsx') ||
              id.includes('/node_modules/@haklex/rich-ext-embed/') ||
              id.includes('/node_modules/@haklex/rich-ext-gallery/') ||
              id.includes('/node_modules/@haklex/rich-ext-nested-doc/')
            ) {
              return 'haklex-light';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: adminPort,
      strictPort: true,
      // Keep browser requests same-origin in development. Vite sends /api/* to
      // the matching Core port, while a deliberate VITE_CORE_API_URL override
      // can still target another Core instance directly.
      proxy: {
        '/api': {
          target: `http://localhost:${corePort}`,
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
