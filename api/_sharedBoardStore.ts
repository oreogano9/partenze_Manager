import { list, put, type ListBlobResultBlob } from '@vercel/blob';
import { SHARED_BOARD_BLOB_PATH } from './_blobConfig.js';

const readPublicBlobText = async (blob: ListBlobResultBlob) => {
  const urls = [blob.url, blob.downloadUrl].filter((url, index, all) => url && all.indexOf(url) === index);

  for (const url of urls) {
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }

    if (response.ok) {
      return response.text();
    }
  }

  for (const url of urls) {
    const fetchUrl = new URL(url);
    fetchUrl.searchParams.set('cache', '0');
    const response = await fetch(fetchUrl);
    if (response.status === 404) {
      return null;
    }

    if (response.ok) {
      return response.text();
    }
  }

  throw new Error('Failed to fetch blob from public URL or download URL');
};

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

  return readPublicBlobText(matchedBlob);
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
