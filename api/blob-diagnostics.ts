import { del, get, put } from '@vercel/blob';
import { getBlobTokenInfo, missingBlobTokenMessage, SHARED_BOARD_BLOB_PATH } from './_blobConfig.js';

const DIAGNOSTIC_BLOB_PATH = 'partenze-manager/blob-diagnostics.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const tokenInfo = getBlobTokenInfo();
  const basePayload = {
    hasBlobReadWriteToken: tokenInfo.hasModernToken,
    hasBlobV1ReadWriteToken: tokenInfo.hasLegacyToken,
    activeTokenSource: tokenInfo.source,
    sharedBoardPath: SHARED_BOARD_BLOB_PATH,
  };

  if (!tokenInfo.token) {
    res.status(500).json({
      ...basePayload,
      ok: false,
      error: missingBlobTokenMessage,
    });
    return;
  }

  try {
    const sharedBlob = await get(SHARED_BOARD_BLOB_PATH, {
      access: 'private',
      token: tokenInfo.token,
      useCache: false,
    });
    const sharedRaw = sharedBlob?.statusCode === 200
      ? await new Response(sharedBlob.stream).text()
      : '';
    const sharedParsed = sharedRaw.trim() ? JSON.parse(sharedRaw) as { flights?: unknown; filters?: unknown; savedAt?: unknown } | unknown[] : null;
    const sharedFlights = Array.isArray(sharedParsed)
      ? sharedParsed
      : Array.isArray(sharedParsed?.flights)
        ? sharedParsed.flights
        : [];

    if (req.method === 'GET') {
      res.status(200).json({
        ...basePayload,
        ok: true,
        canReadSharedBoard: true,
        sharedBoardExists: sharedBlob?.statusCode === 200,
        sharedFlightCount: sharedFlights.length,
        sharedSavedAt: !Array.isArray(sharedParsed) && typeof sharedParsed?.savedAt === 'string'
          ? sharedParsed.savedAt
          : null,
      });
      return;
    }

    const probe = {
      checkedAt: new Date().toISOString(),
      activeTokenSource: tokenInfo.source,
    };

    await put(DIAGNOSTIC_BLOB_PATH, JSON.stringify(probe), {
      access: 'private',
      token: tokenInfo.token,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: 'application/json',
    });

    const probeBlob = await get(DIAGNOSTIC_BLOB_PATH, {
      access: 'private',
      token: tokenInfo.token,
      useCache: false,
    });
    const probeRaw = probeBlob?.statusCode === 200 ? await new Response(probeBlob.stream).text() : '';

    await del(DIAGNOSTIC_BLOB_PATH, {
      token: tokenInfo.token,
    });

    res.status(200).json({
      ...basePayload,
      ok: true,
      canReadSharedBoard: true,
      sharedBoardExists: sharedBlob?.statusCode === 200,
      sharedFlightCount: sharedFlights.length,
      canWriteProbe: true,
      canReadProbe: probeRaw.includes(probe.checkedAt),
    });
  } catch (error) {
    res.status(500).json({
      ...basePayload,
      ok: false,
      error: error instanceof Error ? error.message : 'Blob diagnostics failed',
    });
  }
}
