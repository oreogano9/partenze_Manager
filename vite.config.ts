import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {IncomingMessage, ServerResponse} from 'node:http';
import path from 'path';
import {defineConfig} from 'vite';
import {put} from '@vercel/blob';
import {extractFlightsWithOpenAI} from './server/openaiVision';

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });

const parseMultipartForm = (buffer: Buffer, boundary: string) => {
  const boundaryMarker = `--${boundary}`;
  const segments = buffer.toString('latin1').split(boundaryMarker).slice(1, -1);

  for (const segment of segments) {
    const trimmed = segment.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const separator = trimmed.indexOf('\r\n\r\n');
    if (separator === -1) {
      continue;
    }

    const rawHeaders = trimmed.slice(0, separator);
    const content = trimmed.slice(separator + 4);
    const disposition = rawHeaders.match(/name="([^"]+)".*filename="([^"]+)"/i);
    const typeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i);

    if (!disposition) {
      continue;
    }

    return {
      fieldName: disposition[1],
      filename: disposition[2],
      contentType: typeMatch?.[1]?.trim() || 'application/octet-stream',
      data: Buffer.from(content, 'latin1'),
    };
  }

  return null;
};

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
            const contentType = req.headers['content-type'] || '';
            const boundaryMatch = contentType.match(/boundary=(.+)$/);
            if (!boundaryMatch) {
              sendJson(res, 400, {error: 'Missing multipart boundary'});
              return;
            }

            const body = await readBody(req);
            const filePart = parseMultipartForm(body, boundaryMatch[1]);
            if (!filePart) {
              sendJson(res, 400, {error: 'Missing image upload'});
              return;
            }

            const blob = await put(`ocr-uploads/${Date.now()}-${filePart.filename}`, filePart.data, {
              access: 'public',
              addRandomSuffix: true,
              contentType: filePart.contentType,
            });

            const result = await extractFlightsWithOpenAI(blob.url);
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
