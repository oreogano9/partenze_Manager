import { list, put } from '@vercel/blob';
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

  const fetchUrl = new URL(matchedBlob.url);
  fetchUrl.searchParams.set('cache', '0');
  const blob = await fetch(fetchUrl);

  if (blob.status === 404) {
    return null;
  }

  if (!blob.ok) {
    throw new Error(`Failed to fetch blob: ${blob.status} ${blob.statusText}`);
  }

  return blob.text();
};

export const readSharedBoardText = (token: string) =>
  readBlobTextByPath(SHARED_BOARD_BLOB_PATH, token);

export const writeSharedBoardText = (body: string, token: string) =>
  put(SHARED_BOARD_BLOB_PATH, body, {
    access: 'public',
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
  });
