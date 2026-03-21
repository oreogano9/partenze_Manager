import {OCRExtractionResult} from '../types';

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

export const extractFlightsFromImage = async (
  image: File,
  onProgress?: (progress: number) => void,
): Promise<OCRExtractionResult> => {
  onProgress?.(0.1);
  const imageDataUrl = await fileToDataUrl(image);
  onProgress?.(0.35);

  const response = await fetch('/api/extract-flights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({imageDataUrl}),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Flight extraction failed');
  }

  onProgress?.(0.9);
  const result = await response.json() as OCRExtractionResult;
  onProgress?.(1);
  return result;
};
