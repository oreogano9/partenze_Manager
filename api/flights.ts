import { getBlobTokenInfo, missingBlobTokenMessage } from './_blobConfig.js';
import { readSharedBoardText, writeSharedBoardText } from './_sharedBoardStore.js';

type SharedBoardPayload = {
  flights?: unknown;
  filters?: unknown;
  arrivalStats?: unknown;
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
const ensureArrivalStatsArray = (value: unknown) => (Array.isArray(value) ? value : []);

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const { token: blobToken } = getBlobTokenInfo();

  if (!blobToken) {
    res.status(500).json({ error: missingBlobTokenMessage });
    return;
  }

  if (req.method === 'GET') {
    try {
      const rawText = await readSharedBoardText(blobToken);
      if (!rawText?.trim()) {
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
      const arrivalStats = Array.isArray(parsed)
        ? []
        : ensureArrivalStatsArray((parsed as { arrivalStats?: unknown }).arrivalStats);
      const savedAt = Array.isArray(parsed)
        ? undefined
        : (typeof parsed.savedAt === 'string' ? parsed.savedAt : undefined);

      res.status(200).json({ flights, filters, arrivalStats, savedAt, count: flights.length });
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
      const arrivalStats = ensureArrivalStatsArray(body.arrivalStats);
      const savedAt = new Date().toISOString();

      await writeSharedBoardText(JSON.stringify({ flights, filters, arrivalStats, savedAt }), blobToken);

      res.status(200).json({ ok: true, count: flights.length, savedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save shared flights';
      res.status(500).json({ error: message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
