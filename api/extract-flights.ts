import {extractFlightsWithOpenAI} from '../server/openaiVision';

const readBody = (body: unknown) => {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body) as {imageDataUrl?: string};
  }

  return body as {imageDataUrl?: string};
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Method not allowed'});
    return;
  }

  try {
    const body = readBody(req.body);
    if (!body.imageDataUrl) {
      res.status(400).json({error: 'Missing imageDataUrl'});
      return;
    }

    const result = await extractFlightsWithOpenAI(body.imageDataUrl);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flight extraction failed';
    res.status(500).json({error: message});
  }
}
