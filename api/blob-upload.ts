import {handleUpload} from '@vercel/blob/client';
import { getBlobTokenInfo, missingBlobTokenMessage } from './_blobConfig.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Method not allowed'});
    return;
  }

  const { token: blobToken } = getBlobTokenInfo();
  if (!blobToken) {
    res.status(500).json({error: missingBlobTokenMessage});
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const jsonResponse = await handleUpload({
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

    res.status(200).json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Blob upload failed';
    res.status(500).json({error: message});
  }
}
