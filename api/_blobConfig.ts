export const SHARED_BOARD_BLOB_PATH = 'partenze-manager/shared-board.json';

export const getBlobTokenInfo = () => {
  const modernToken = process.env.BLOB_READ_WRITE_TOKEN;
  const legacyToken = process.env.BLOBV1_READ_WRITE_TOKEN;
  const token = modernToken || legacyToken;

  return {
    token,
    source: modernToken ? 'BLOB_READ_WRITE_TOKEN' : legacyToken ? 'BLOBV1_READ_WRITE_TOKEN' : null,
    hasModernToken: Boolean(modernToken),
    hasLegacyToken: Boolean(legacyToken),
  };
};

export const missingBlobTokenMessage = 'Missing BLOB_READ_WRITE_TOKEN or BLOBV1_READ_WRITE_TOKEN';
