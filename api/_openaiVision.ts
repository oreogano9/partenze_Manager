import type {OCRExtractionResult, OCRFlightCandidate, TerminalType} from '../src/types';

type RawFlight = {
  flightNumber?: unknown;
  destination?: unknown;
  std?: unknown;
  terminal?: unknown;
  position?: unknown;
  sourceLine?: unknown;
  confidence?: unknown;
  fc?: unknown;
  richiesta?: unknown;
  tot?: unknown;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeTime = (value: string) => {
  const match = value.replace('.', ':').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return '';
  }

  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  return `${hours}:${minutes}`;
};

const buildISODate = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const normalizeTerminal = (value: string): TerminalType => (value === 'T2' ? 'T2' : 'T1');

const normalizeFlight = (raw: RawFlight, index: number): OCRFlightCandidate | null => {
  const flightNumber = asString(raw.flightNumber).toUpperCase();
  const destination = asString(raw.destination).toUpperCase();
  const hhmm = normalizeTime(asString(raw.std));

  if (!flightNumber || !destination || !hhmm) {
    return null;
  }

  const confidenceValue = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceValue) ? clamp(confidenceValue, 0, 1) : 0.8;

  return {
    id: `ocr-${Date.now()}-${index}`,
    flightNumber,
    destination,
    std: buildISODate(hhmm),
    terminal: normalizeTerminal(asString(raw.terminal).toUpperCase()),
    position: asString(raw.position).toUpperCase(),
    tags: ['Smistato'],
    fc: asString(raw.fc).toUpperCase() || undefined,
    richiesta: asString(raw.richiesta) || undefined,
    tot: asString(raw.tot).toUpperCase() || undefined,
    sourceLine: asString(raw.sourceLine),
    confidence: Number(confidence.toFixed(2)),
  };
};

const normalizeResponse = (payload: unknown): OCRExtractionResult => {
  const object = payload && typeof payload === 'object' ? (payload as {text?: unknown; flights?: unknown}) : {};
  const rawFlights = Array.isArray(object.flights) ? (object.flights as RawFlight[]) : [];

  return {
    text: asString(object.text),
    flights: rawFlights
      .map((flight, index) => normalizeFlight(flight, index))
      .filter((flight): flight is OCRFlightCandidate => Boolean(flight)),
  };
};

const getMessageText = (content: unknown) => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
          return typeof item.text === 'string' ? item.text : '';
        }
        return '';
      })
      .join('');
  }

  return '';
};

export const extractFlightsWithOpenAI = async (imageUrl: string): Promise<OCRExtractionResult> => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      response_format: {type: 'json_object'},
      messages: [
        {
          role: 'system',
          content:
            'You extract flight rows from airport operation sheets. Return JSON only with shape {"text":"best effort raw transcription","flights":[{"flightNumber":"","destination":"","std":"HH:mm","terminal":"T1 or T2","position":"","sourceLine":"","confidence":0.0,"fc":"","richiesta":"","tot":""}]}. Do not invent flights that are not visible. Keep unknown fields as empty strings. Use HH:mm 24-hour time.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Read this image and extract visible flight rows. Prefer accurate rows over complete coverage. If a row is ambiguous, leave fields blank rather than guessing.',
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = getMessageText(content);

  if (!text) {
    throw new Error('OpenAI returned no JSON content');
  }

  return normalizeResponse(JSON.parse(text));
};
