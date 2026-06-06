import { get, put } from '@vercel/blob';
import { getBlobTokenInfo, missingBlobTokenMessage, SHARED_BOARD_BLOB_PATH } from './_blobConfig.js';

type SharedBoardPayload = {
  flights?: unknown;
  filters?: unknown;
  savedAt?: unknown;
};

const readBody = (body: unknown) => {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body) as SharedBoardPayload;
  }

  return body as SharedBoardPayload;
};

const ensureFlightArray = (value: unknown) => (Array.isArray(value) ? value : []);

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const { token: blobToken } = getBlobTokenInfo();

  if (!blobToken) {
    res.status(500).json({ error: missingBlobTokenMessage });
    return;
  }

  if (req.method === 'GET') {
    try {
      const blob = await get(SHARED_BOARD_BLOB_PATH, {
        access: 'private',
        token: blobToken,
        useCache: false,
      });

      if (!blob || blob.statusCode !== 200) {
        res.status(200).json({ flights: [] });
        return;
      }

      const rawText = await new Response(blob.stream).text();
      if (!rawText.trim()) {
        res.status(200).json({ flights: [] });
        return;
      }

      const parsed = JSON.parse(rawText) as SharedBoardPayload | unknown[];
      const flights = Array.isArray(parsed)
        ? ensureFlightArray(parsed)
        : ensureFlightArray((parsed as { flights?: unknown }).flights);
      const filters = Array.isArray(parsed)
        ? undefined
        : (parsed as { filters?: unknown }).filters;
      const savedAt = Array.isArray(parsed)
        ? undefined
        : (typeof parsed.savedAt === 'string' ? parsed.savedAt : undefined);

      res.status(200).json({ flights, filters, savedAt, count: flights.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load shared flights';
      res.status(500).json({ error: message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = readBody(req.body);
      const flights = ensureFlightArray(body.flights);
      const filters = body.filters && typeof body.filters === 'object' ? body.filters : undefined;
      const savedAt = new Date().toISOString();

      await put(
        SHARED_BOARD_BLOB_PATH,
        JSON.stringify({ flights, filters, savedAt }),
        {
          access: 'private',
          token: blobToken,
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: 'application/json',
        },
      );

      res.status(200).json({ ok: true, count: flights.length, savedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save shared flights';
      res.status(500).json({ error: message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
