import {extractFlightsWithOpenAI} from './_openaiVision.js';
import type {TerminalType} from '../src/types';

const readBody = (body: unknown) => {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body) as {imageUrl?: string; preferredTerminal?: TerminalType};
  }

  return body as {imageUrl?: string; preferredTerminal?: TerminalType};
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Method not allowed'});
    return;
  }

  try {
    const body = readBody(req.body);
    if (!body.imageUrl) {
      res.status(400).json({error: 'Missing imageUrl'});
      return;
    }

    const result = await extractFlightsWithOpenAI(body.imageUrl, body.preferredTerminal);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flight extraction failed';
    res.status(500).json({error: message});
  }
}
