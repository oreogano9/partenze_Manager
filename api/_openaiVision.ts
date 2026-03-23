import type {OCRExtractionResult, OCRFlightCandidate, OCRSourceType, TerminalType} from '../src/types';

type RawFlight = {
  carrier?: unknown;
  flightNumberNumeric?: unknown;
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
  anomaly?: unknown;
  bag?: unknown;
  crossedOut?: unknown;
  sourceType?: unknown;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const asBoolean = (value: unknown) => value === true;
const normalizeSourceType = (value: unknown): OCRSourceType =>
  value === 'bay_screen' ? 'bay_screen' : 'sheet';
const normalizeFlightCodeFormat = (value: string) => {
  const compact = value.toUpperCase().trim().replace(/[\s-]+/g, '');
  const match = compact.match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  if (!match) {
    return value.toUpperCase().trim().replace(/\s+/g, ' ');
  }
  return `${match[1]} ${match[2]}`;
};

const normalizeFlightNumber = (raw: RawFlight) => {
  const directFlightNumber = normalizeFlightCodeFormat(asString(raw.flightNumber));
  if (directFlightNumber) {
    return directFlightNumber;
  }

  const carrier = asString(raw.carrier).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const numeric = asString(raw.flightNumberNumeric).toUpperCase();

  if (!carrier || !numeric) {
    return '';
  }

  return `${carrier} ${numeric}`;
};

const normalizeTime = (value: string) => {
  const match = value.replace('.', ':').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return '';
  }

  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  return `${hours}:${minutes}`;
};

const getRomeDateParts = () => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return { year, month, day };
};

const buildISODate = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const { year, month, day } = getRomeDateParts();
  return `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
};

const normalizeTerminal = (value: string, preferredTerminal?: TerminalType): TerminalType => {
  if (value === 'T3') {
    return 'T3';
  }
  if (value === 'T1') {
    return 'T1';
  }
  return preferredTerminal || 'T1';
};

const normalizeFlight = (
  raw: RawFlight,
  index: number,
  sourceType: OCRSourceType,
  preferredTerminal?: TerminalType,
): OCRFlightCandidate | null => {
  const carrier = asString(raw.carrier).toUpperCase();
  const flightNumberNumeric = asString(raw.flightNumberNumeric).toUpperCase();
  const flightNumber = normalizeFlightNumber(raw);
  const destination = asString(raw.destination).toUpperCase();
  const hhmm = normalizeTime(asString(raw.std));

  if (!flightNumber || !hhmm || (sourceType === 'sheet' && !destination)) {
    return null;
  }

  const confidenceValue = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceValue) ? clamp(confidenceValue, 0, 1) : 0.8;

  return {
    id: `ocr-${Date.now()}-${index}`,
    carrier: carrier || undefined,
    flightNumberNumeric: flightNumberNumeric || undefined,
    flightNumber,
    destination,
    std: buildISODate(hhmm),
    terminal: normalizeTerminal(asString(raw.terminal).toUpperCase(), preferredTerminal),
    position: asString(raw.position).toUpperCase(),
    tags: ['Smistato'],
    fc: asString(raw.fc).toUpperCase() || undefined,
    richiesta: asString(raw.richiesta) || undefined,
    tot: asString(raw.tot).toUpperCase() || undefined,
    anomaly: asString(raw.anomaly) || undefined,
    bag: asString(raw.bag) || undefined,
    sourceLine: asString(raw.sourceLine),
    confidence: Number(confidence.toFixed(2)),
    crossedOut: asBoolean(raw.crossedOut) || undefined,
    sourceType,
  };
};

const normalizeResponse = (payload: unknown, preferredTerminal?: TerminalType): OCRExtractionResult => {
  const object = payload && typeof payload === 'object'
    ? (payload as {text?: unknown; flights?: unknown; sourceType?: unknown})
    : {};
  const rawFlights = Array.isArray(object.flights) ? (object.flights as RawFlight[]) : [];
  const sourceType = normalizeSourceType(object.sourceType);

  return {
    sourceType,
    text: asString(object.text),
    flights: rawFlights
      .map((flight, index) => normalizeFlight(flight, index, sourceType, preferredTerminal))
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

export const extractFlightsWithOpenAI = async (imageUrl: string, preferredTerminal?: TerminalType): Promise<OCRExtractionResult> => {
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
            'You extract flight rows from either airport operation sheets or live bay-screen monitors. Return JSON only with shape {"sourceType":"sheet or bay_screen","text":"best effort raw transcription","flights":[{"carrier":"","flightNumberNumeric":"","flightNumber":"","destination":"","std":"HH:mm","terminal":"T1 or T3","position":"","sourceLine":"","confidence":0.0,"fc":"","richiesta":"","tot":"","anomaly":"","bag":"","crossedOut":false}]}. Do not invent flights that are not visible. Keep unknown fields as empty strings. Use HH:mm 24-hour time. Detect whether the image is a paper sheet or a live bay-screen monitor and set sourceType accordingly. If the image is a bay screen, extract only flight code, destination if visible, bay/position, and departure time. Ignore baggage opening time, luggage counters, and other status metrics. If the sheet has separate CARR and FLT.N columns, extract both and also return flightNumber combined with a space, for example "FR 244", "LH 231", "VY 6101". Do not return a bare numeric flight number if the prefix is present anywhere on the same row. Treat the long central request column as the requested container mix/instructions and preserve it verbatim in richiesta. Do not move that full request text into fc. Use fc only for the dedicated FC column when it is actually filled or clearly visible as its own value. Preserve TOT, ANOMALIA, and BAG from their own columns when visible. Set crossedOut to true when an item or row is visibly crossed out, struck through, or clearly marked as cancelled/void by pen or marker.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Read this image and extract visible flight rows. Prefer accurate rows over complete coverage. If a row is ambiguous, leave fields blank rather than guessing. Normalize flight numbers so forms like "FC2355", "FC 2355", and "FC-2355" all resolve to the same flight code value "FC 2355". Keep the full flight code with airline prefix when visible, such as "FR 244" rather than only "244". If this is a live bay screen, use the screen header bay as position for all rows when appropriate, keep only flight code, destination if visible, bay/position, and the repeated departure time column, and ignore baggage-opening times and luggage counters. Many paper sheets use headers like CARR, FLT.N, DEST, STD, BAIA, FC, a long request/instructions column, TOT, ANOMALIA, and BAG. BAIA maps to position. The long request/instructions column should be preserved exactly in richiesta, including tokens like BL, BT, BS, FC, AKH, route notes in parentheses, and free-text notes. TOT should preserve values like "7AKH". Mark crossedOut as true for rows that appear crossed out or cancelled. This image should be treated as terminal ${preferredTerminal || 'T1'} unless it clearly says otherwise.`,
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

  return normalizeResponse(JSON.parse(text), preferredTerminal);
};
