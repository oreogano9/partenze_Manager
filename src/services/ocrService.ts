import {upload} from '@vercel/blob/client';
import {OCRExtractionResult} from '../types';

const fileToImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image file'));
      image.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

const resizeImageToDataUrl = async (file: File) => {
  const image = await fileToImage(file);
  const maxDimension = 1200;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare image for upload');
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.68);
};

const extractErrorMessage = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return 'Flight extraction failed';
  }

  try {
    const payload = JSON.parse(text) as {error?: string};
    return payload.error || text;
  } catch {
    return text;
  }
};

const trimErrorMessage = (message: string) => {
  if (message.length <= 240) {
    return message;
  }
  return `${message.slice(0, 237)}...`;
};

const normalizeError = (error: unknown) => {
  if (error instanceof Error) {
    return new Error(trimErrorMessage(error.message));
  }
  return new Error('Flight extraction failed');
};

const uploadImageToBlob = async (file: File, onProgress?: (progress: number) => void) => {
  try {
    const blob = await upload(`ocr-uploads/${Date.now()}-${file.name}`, file, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      onUploadProgress: event => {
        const rawPercentage = typeof event.percentage === 'number' ? event.percentage : 0;
        const normalizedPercentage = rawPercentage > 1 ? rawPercentage / 100 : rawPercentage;
        onProgress?.(0.1 + normalizedPercentage * 0.45);
      },
    });
    return blob.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Blob upload failed';
    throw new Error(`Image upload failed: ${message}`);
  }
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const optimizeImageFile = async (file: File) => {
  try {
    const dataUrl = await resizeImageToDataUrl(file);
    const blob = await dataUrlToBlob(dataUrl);
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {type: 'image/jpeg'});
  } catch {
    return file;
  }
};

export const extractFlightsFromImage = async (
  image: File,
  onProgress?: (progress: number) => void,
): Promise<OCRExtractionResult> => {
  try {
    onProgress?.(0.05);
    const optimizedImage = await optimizeImageFile(image);
    onProgress?.(0.1);

    if (optimizedImage.size > 4_000_000) {
      throw new Error('Image is still too large. Try cropping tighter around the flight table.');
    }

    const imageUrl = await uploadImageToBlob(optimizedImage, onProgress);
    onProgress?.(0.65);

    const formData = new FormData();
    const response = await fetch('/api/extract-flights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({imageUrl}),
    });

    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }

    onProgress?.(0.9);
    const result = await response.json() as OCRExtractionResult;
    onProgress?.(1);
    return result;
  } catch (error) {
    throw normalizeError(error);
  }
};
