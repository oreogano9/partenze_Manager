import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {readFile, writeFile} from 'node:fs/promises';
import {IncomingMessage, ServerResponse} from 'node:http';
import path from 'path';
import {defineConfig} from 'vite';
import {handleUpload} from '@vercel/blob/client';
import {extractFlightsWithOpenAI} from './api/_openaiVision.js';
import type {TerminalType} from './src/types';

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOBV1_READ_WRITE_TOKEN;
const localSharedBoardPath = path.resolve(__dirname, '.partenze-manager.local-board.json');

type LocalSharedBoard = {
  flights?: unknown[];
  filters?: unknown;
  savedAt?: string;
};

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
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
};

const readLocalSharedBoard = async (): Promise<LocalSharedBoard> => {
  try {
    const raw = await readFile(localSharedBoardPath, 'utf8');
    const parsed = JSON.parse(raw) as LocalSharedBoard;
    return {
      flights: Array.isArray(parsed.flights) ? parsed.flights : [],
      filters: parsed.filters,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : undefined,
    };
  } catch {
    return {flights: []};
  }
};

const writeLocalSharedBoard = async (payload: LocalSharedBoard) => {
  await writeFile(localSharedBoardPath, JSON.stringify(payload, null, 2), 'utf8');
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

        server.middlewares.use('/api/flights', async (req, res, next) => {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, await readLocalSharedBoard());
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to load shared flights';
              sendJson(res, 500, {error: message});
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const rawBody = await readBody(req);
              const body = rawBody ? (JSON.parse(rawBody) as {flights?: unknown; filters?: unknown}) : {};
              const flights = Array.isArray(body.flights) ? body.flights : [];
              const filters = body.filters && typeof body.filters === 'object' ? body.filters : undefined;
              const savedAt = new Date().toISOString();
              await writeLocalSharedBoard({flights, filters, savedAt});
              sendJson(res, 200, {ok: true, count: flights.length, savedAt});
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to save shared flights';
              sendJson(res, 500, {error: message});
            }
            return;
          }

          if (req.method) {
            sendJson(res, 405, {error: 'Method not allowed'});
            return;
          }

          next();
        });

        server.middlewares.use('/api/blob-diagnostics', async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'POST') {
            if (req.method) {
              sendJson(res, 405, {error: 'Method not allowed'});
              return;
            }

            next();
            return;
          }

          try {
            const localBoard = await readLocalSharedBoard();
            sendJson(res, 200, {
              ok: true,
              mode: 'local-dev-file',
              hasBlobReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
              hasBlobV1ReadWriteToken: Boolean(process.env.BLOBV1_READ_WRITE_TOKEN),
              activeTokenSource: process.env.BLOB_READ_WRITE_TOKEN
                ? 'BLOB_READ_WRITE_TOKEN'
                : process.env.BLOBV1_READ_WRITE_TOKEN
                  ? 'BLOBV1_READ_WRITE_TOKEN'
                  : null,
              sharedBoardPath: localSharedBoardPath,
              sharedBoardExists: true,
              sharedFlightCount: Array.isArray(localBoard.flights) ? localBoard.flights.length : 0,
              sharedSavedAt: localBoard.savedAt ?? null,
              canReadSharedBoard: true,
              canWriteProbe: req.method === 'POST',
              canReadProbe: req.method === 'POST',
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Blob diagnostics failed';
            sendJson(res, 500, {ok: false, mode: 'local-dev-file', error: message});
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
