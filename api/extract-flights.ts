import {put} from '@vercel/blob';
import {extractFlightsWithOpenAI} from '../server/openaiVision';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Method not allowed'});
    return;
  }

  try {
    const formData = await req.formData();
    const file = formData.get('image');

    if (!(file instanceof File)) {
      res.status(400).json({error: 'Missing image upload'});
      return;
    }

    const blob = await put(`ocr-uploads/${Date.now()}-${file.name}`, file, {
      access: 'public',
      addRandomSuffix: true,
    });

    const result = await extractFlightsWithOpenAI(blob.url);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flight extraction failed';
    res.status(500).json({error: message});
  }
}
