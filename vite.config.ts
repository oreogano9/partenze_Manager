import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {IncomingMessage, ServerResponse} from 'node:http';
import path from 'path';
import {defineConfig} from 'vite';
import {handleUpload} from '@vercel/blob/client';
import {extractFlightsWithOpenAI} from './api/_openaiVision.js';
import type {TerminalType} from './src/types';

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOBV1_READ_WRITE_TOKEN;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-openai-extract-route',
      configureServer(server) {
        server.middlewares.use('/api/blob-upload', async (req, res, next) => {
          if (req.method !== 'POST') {
            next();
            return;
          }

          try {
            const rawBody = await readBody(req);
            const body = rawBody ? JSON.parse(rawBody) : {};
            const result = await handleUpload({
              token: blobToken,
              request: req,
              body,
              onBeforeGenerateToken: async () => ({
                allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
                maximumSizeInBytes: 4_000_000,
                addRandomSuffix: true,
              }),
              onUploadCompleted: async () => {},
            });
            sendJson(res, 200, result);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Blob upload failed';
            sendJson(res, 500, {error: message});
          }
        });

        server.middlewares.use('/api/extract-flights', async (req, res, next) => {
          if (req.method !== 'POST') {
            next();
            return;
          }

          try {
            const rawBody = await readBody(req);
            const body = rawBody ? (JSON.parse(rawBody) as {imageUrl?: string; preferredTerminal?: TerminalType}) : {};
            if (!body.imageUrl) {
              sendJson(res, 400, {error: 'Missing imageUrl'});
              return;
            }

            const result = await extractFlightsWithOpenAI(body.imageUrl, body.preferredTerminal);
            sendJson(res, 200, result);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Flight extraction failed';
            sendJson(res, 500, {error: message});
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify-file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
