import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {IncomingMessage, ServerResponse} from 'node:http';
import path from 'path';
import {defineConfig} from 'vite';
import {extractFlightsWithOpenAI} from './server/openaiVision';

const readJsonBody = (req: IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
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
        server.middlewares.use('/api/extract-flights', async (req, res, next) => {
          if (req.method !== 'POST') {
            next();
            return;
          }

          try {
            const body = await readJsonBody(req);
            if (!body.imageDataUrl) {
              sendJson(res, 400, {error: 'Missing imageDataUrl'});
              return;
            }

            const result = await extractFlightsWithOpenAI(body.imageDataUrl);
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
