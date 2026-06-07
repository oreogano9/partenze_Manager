import { get, list, put } from '@vercel/blob';
import { SHARED_BOARD_BLOB_PATH } from './_blobConfig.js';

export const readBlobTextByPath = async (pathname: string, token: string) => {
  const listed = await list({
    prefix: pathname,
    limit: 10,
    token,
  });
  const matchedBlob = listed.blobs.find((blob) => blob.pathname === pathname);

  if (!matchedBlob) {
    return null;
  }

  const blob = await get(matchedBlob.url, {
    access: 'private',
    token,
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200) {
    return null;
  }

  return new Response(blob.stream).text();
};

export const readSharedBoardText = (token: string) =>
  readBlobTextByPath(SHARED_BOARD_BLOB_PATH, token);

export const writeSharedBoardText = (body: string, token: string) =>
  put(SHARED_BOARD_BLOB_PATH, body, {
    access: 'private',
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
  });
