import { get, put } from '@vercel/blob';

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOBV1_READ_WRITE_TOKEN;
const SHARED_BOARD_BLOB_PATH = 'partenze-manager/shared-board.json';

const readBody = (body: unknown) => {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body) as { flights?: unknown; filters?: unknown };
  }

  return body as { flights?: unknown; filters?: unknown };
};

const ensureFlightArray = (value: unknown) => (Array.isArray(value) ? value : []);

export default async function handler(req: any, res: any) {
  if (!blobToken) {
    res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });
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

      const parsed = JSON.parse(rawText) as { flights?: unknown } | unknown[];
      const flights = Array.isArray(parsed)
        ? ensureFlightArray(parsed)
        : ensureFlightArray((parsed as { flights?: unknown }).flights);
      const filters = Array.isArray(parsed)
        ? undefined
        : (parsed as { filters?: unknown }).filters;

      res.status(200).json({ flights, filters });
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

      await put(
        SHARED_BOARD_BLOB_PATH,
        JSON.stringify({ flights, filters }),
        {
          access: 'private',
          token: blobToken,
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: 'application/json',
        },
      );

      res.status(200).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save shared flights';
      res.status(500).json({ error: message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
