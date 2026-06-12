import type { Flight } from '../src/types';
import { getBlobTokenInfo, missingBlobTokenMessage } from './_blobConfig.js';
import { readSharedBoardText, writeSharedBoardText } from './_sharedBoardStore.js';

type LiveDirection = 'departure' | 'arrival';
type LiveSource = 'AeroDataBox' | 'FlightView';

type LiveFlight = {
  flightCodes: string[];
  direction: LiveDirection;
  scheduledAt?: string;
  revisedAt?: string;
  scheduledTime?: string;
  revisedTime?: string;
  status?: string;
  place?: string;
  source: LiveSource;
};

type SharedBoardPayload = {
  flights?: Flight[];
  filters?: unknown;
  arrivalStats?: unknown;
};

type ProviderResult = {
  source: LiveSource;
  flights: LiveFlight[];
  fallbackUsed: boolean;
};

const ROME_TIME_ZONE = 'Europe/Rome';
const AERODATABOX_BASE_URL = 'https://portal.aerodatabox.com/backend/airport/LIRF';
const FLIGHTVIEW_BASE_URL = 'https://app-api.flightview.com/api/airport/FCO';

const readBody = (body: unknown) => {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body) as SharedBoardPayload;
  }

  return body as SharedBoardPayload;
};

const normalizeFlightCode = (value: string) => {
  const compact = value.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const match =
    compact.match(/^([A-Z]\d[A-Z]?)(\d{1,5}[A-Z]?)$/) ||
    compact.match(/^(\d[A-Z]{1,2})(\d{1,5}[A-Z]?)$/) ||
    compact.match(/^([A-Z]{1,3})(\d{1,5}[A-Z]?)$/);

  if (!match) {
    return compact;
  }

  return `${match[1]}${match[2]}`;
};

const getFlightCodes = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [normalizeFlightCode(value)].filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap(getFlightCodes);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...getFlightCodes(record.number),
    ...getFlightCodes(record.flightNumber),
    ...getFlightCodes(record.serviceNumber),
    ...getFlightCodes(record.codeshareServiceNumber),
  ];
};

const formatRomeDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const getFlightDateKey = (flight: Flight) => {
  const date = new Date(flight.std);
  return Number.isNaN(date.getTime()) ? flight.std.slice(0, 10) : formatRomeDate(date);
};

const toRomeLocalDateTime = (dateKey: string, hhmm: string) => `${dateKey}T${hhmm}:00`;

const extractHhmm = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]}:${match[2]}` : undefined;
};

const getTimeObjectValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return (
    (typeof record.local === 'string' && record.local) ||
    (typeof record.utc === 'string' && record.utc) ||
    (typeof record.scheduled === 'string' && record.scheduled) ||
    (typeof record.estimated === 'string' && record.estimated) ||
    (typeof record.actual === 'string' && record.actual) ||
    undefined
  );
};

const getIsoLikeTime = (value: unknown): string | undefined => {
  const raw = getTimeObjectValue(value);
  if (!raw) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw;
  }

  return undefined;
};

const buildFlightTime = (flight: Flight, value?: string) => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }

  const hhmm = extractHhmm(value);
  const dateKey = getFlightDateKey(flight);
  if (!hhmm || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return undefined;
  }

  return toRomeLocalDateTime(dateKey, hhmm);
};

const minutesBetween = (from?: string, to?: string) => {
  if (!from || !to) {
    return undefined;
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return undefined;
  }

  return Math.round((toDate.getTime() - fromDate.getTime()) / 60000);
};

const sameFlightValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isArrivalFlight = (flight: Flight) =>
  flight.sourceType === 'arrival_screen' || flight.tags.includes('Arrivo');

const collectRows = (value: unknown, predicate: (record: Record<string, unknown>) => boolean, rows: Record<string, unknown>[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRows(item, predicate, rows));
    return rows;
  }

  if (!value || typeof value !== 'object') {
    return rows;
  }

  const record = value as Record<string, unknown>;
  if (predicate(record)) {
    rows.push(record);
  }

  Object.values(record).forEach((item) => collectRows(item, predicate, rows));
  return rows;
};

const pickString = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();

const getAirportField = (value: unknown, field: 'name' | 'iata') => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const airport = (value as Record<string, unknown>).airport;
  if (!airport || typeof airport !== 'object') {
    return undefined;
  }

  const airportValue = (airport as Record<string, unknown>)[field];
  return typeof airportValue === 'string' ? airportValue : undefined;
};

const parseAeroDataBoxFlights = (payload: unknown, direction: LiveDirection): LiveFlight[] => {
  const rows = collectRows(payload, (record) => (
    Boolean(record.flight && typeof record.flight === 'object') ||
    Boolean(record.number || record.flightNumber)
  ));

  return rows.map((row) => {
    const flightObject = row.flight && typeof row.flight === 'object' ? row.flight as Record<string, unknown> : row;
    const directionObject = direction === 'departure' ? row.departure : row.arrival;
    const timeRecord = directionObject && typeof directionObject === 'object'
      ? directionObject as Record<string, unknown>
      : row;
    const scheduledValue = timeRecord.scheduledTime ?? timeRecord.scheduled ?? row.scheduledTime;
    const revisedValue = timeRecord.revisedTime ?? timeRecord.actualTime ?? timeRecord.estimatedTime ?? timeRecord.revised ?? row.revisedTime;
    const scheduledRaw = getTimeObjectValue(scheduledValue);
    const revisedRaw = getTimeObjectValue(revisedValue);

    return {
      flightCodes: Array.from(new Set(getFlightCodes(flightObject))),
      direction,
      scheduledAt: getIsoLikeTime(scheduledValue),
      revisedAt: getIsoLikeTime(revisedValue),
      scheduledTime: extractHhmm(scheduledRaw),
      revisedTime: extractHhmm(revisedRaw),
      status: pickString(row.status, row.displayStatus),
      place: pickString(
        getAirportField(direction === 'departure' ? row.arrival : row.departure, 'name'),
        getAirportField(direction === 'departure' ? row.arrival : row.departure, 'iata'),
      ),
      source: 'AeroDataBox' as const,
    };
  }).filter((flight) => flight.flightCodes.length > 0 && Boolean(flight.scheduledAt || flight.revisedAt || flight.scheduledTime || flight.revisedTime));
};

const parseFlightViewFlights = (payload: unknown, direction: LiveDirection): LiveFlight[] => {
  const rows = collectRows(payload, (record) => Boolean(record.flightNumber || record.number || record.flight));

  return rows.map((row) => {
    const scheduledRaw = pickString(row.scheduledTime, row.scheduled, row.departureTime, row.arrivalTime);
    const revisedRaw = pickString(row.updatedTime, row.estimatedTime, row.actualTime, row.revisedTime);

    return {
      flightCodes: Array.from(new Set(getFlightCodes(row.flight ?? row.flightNumber ?? row.number))),
      direction,
      scheduledAt: getIsoLikeTime(scheduledRaw),
      revisedAt: getIsoLikeTime(revisedRaw),
      scheduledTime: extractHhmm(scheduledRaw),
      revisedTime: extractHhmm(revisedRaw),
      status: pickString(row.displayStatus, row.status),
      place: pickString(row.airportFrom, row.airportTo, row.airport),
      source: 'FlightView' as const,
    };
  }).filter((flight) => flight.flightCodes.length > 0 && Boolean(flight.scheduledAt || flight.revisedAt || flight.scheduledTime || flight.revisedTime));
};

const fetchJson = async (url: string, source: LiveSource) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 PartenzeManager/1.0',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'en-GB,en;q=0.9',
      Referer: source === 'AeroDataBox' ? 'https://portal.aerodatabox.com/' : 'https://www.flightview.com/',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const message = text.trim().slice(0, 160) || response.statusText;
    throw new Error(`${source} ${response.status}: ${message}`);
  }

  return text ? JSON.parse(text) : null;
};

const fetchAeroDataBoxFlights = async (directions: LiveDirection[]) => {
  const flights: LiveFlight[] = [];

  for (const direction of directions) {
    const payload = await fetchJson(`${AERODATABOX_BASE_URL}/${direction === 'departure' ? 'departures' : 'arrivals'}`, 'AeroDataBox');
    flights.push(...parseAeroDataBoxFlights(payload, direction));
  }

  return flights;
};

const fetchFlightViewFlights = async (directions: LiveDirection[]) => {
  const flights: LiveFlight[] = [];

  for (const direction of directions) {
    const payload = await fetchJson(`${FLIGHTVIEW_BASE_URL}/${direction === 'departure' ? 'departures' : 'arrivals'}`, 'FlightView');
    flights.push(...parseFlightViewFlights(payload, direction));
  }

  return flights;
};

const fetchLiveFlights = async (directions: LiveDirection[]): Promise<ProviderResult> => {
  const providerErrors: string[] = [];

  try {
    return {
      source: 'AeroDataBox',
      flights: await fetchAeroDataBoxFlights(directions),
      fallbackUsed: false,
    };
  } catch (error) {
    providerErrors.push(error instanceof Error ? error.message : 'AeroDataBox failed');
  }

  try {
    return {
      source: 'FlightView',
      flights: await fetchFlightViewFlights(directions),
      fallbackUsed: true,
    };
  } catch (error) {
    providerErrors.push(error instanceof Error ? error.message : 'FlightView failed');
  }

  throw new Error(`Live sync blocked or unavailable. ${providerErrors.join(' | ')}`);
};

const readSharedBoard = async (): Promise<SharedBoardPayload> => {
  const { token: blobToken } = getBlobTokenInfo();
  if (!blobToken) {
    return { flights: [] };
  }

  const rawText = await readSharedBoardText(blobToken);
  if (!rawText?.trim()) {
    return { flights: [] };
  }

  const parsed = JSON.parse(rawText) as SharedBoardPayload | Flight[];
  return Array.isArray(parsed)
    ? { flights: parsed }
    : {
      flights: Array.isArray(parsed.flights) ? parsed.flights : [],
      filters: parsed.filters,
      arrivalStats: parsed.arrivalStats,
    };
};

const writeSharedBoard = async (flights: Flight[], filters: unknown, arrivalStats: unknown) => {
  const { token: blobToken } = getBlobTokenInfo();
  if (!blobToken) {
    return;
  }

  await writeSharedBoardText(JSON.stringify({ flights, filters, arrivalStats, savedAt: new Date().toISOString() }), blobToken);
};

const getNeededDirections = (flights: Flight[]) => {
  const directions = new Set<LiveDirection>();
  flights.forEach((flight) => directions.add(isArrivalFlight(flight) ? 'arrival' : 'departure'));
  return Array.from(directions);
};

const makeLiveIndex = (liveFlights: LiveFlight[]) => {
  const index = new Map<string, LiveFlight[]>();
  liveFlights.forEach((flight) => {
    flight.flightCodes.forEach((code) => {
      const key = normalizeFlightCode(code);
      index.set(key, [...(index.get(key) ?? []), flight]);
    });
  });
  return index;
};

const applyLiveFlight = (flight: Flight, liveFlight: LiveFlight, checkedAt: string) => {
  const scheduledAt = buildFlightTime(flight, liveFlight.scheduledAt || liveFlight.scheduledTime);
  const revisedAt = buildFlightTime(flight, liveFlight.revisedAt || liveFlight.revisedTime);
  const nextStd = revisedAt || scheduledAt || flight.std;
  const delayMinutes = minutesBetween(scheduledAt, revisedAt);

  const nextFlight: Flight = {
    ...flight,
    std: nextStd,
    liveScheduledAt: scheduledAt,
    liveRevisedAt: revisedAt,
    liveDelayMinutes: typeof delayMinutes === 'number' ? delayMinutes : undefined,
    liveStatus: liveFlight.status,
    liveSource: liveFlight.source,
    liveCheckedAt: checkedAt,
  };

  const changed = (
    nextFlight.std !== flight.std ||
    !sameFlightValue(nextFlight.liveScheduledAt, flight.liveScheduledAt) ||
    !sameFlightValue(nextFlight.liveRevisedAt, flight.liveRevisedAt) ||
    !sameFlightValue(nextFlight.liveDelayMinutes, flight.liveDelayMinutes) ||
    !sameFlightValue(nextFlight.liveStatus, flight.liveStatus) ||
    !sameFlightValue(nextFlight.liveSource, flight.liveSource)
  );

  return { flight: nextFlight, changed };
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { token: blobToken } = getBlobTokenInfo();

  if (!blobToken) {
    res.status(500).json({ error: missingBlobTokenMessage });
    return;
  }

  try {
    const body = readBody(req.body);
    const sharedBoard = Array.isArray(body.flights) ? body : await readSharedBoard();
    const flights = Array.isArray(sharedBoard.flights) ? sharedBoard.flights : [];
    if (flights.length === 0) {
      res.status(200).json({ flights: [], updatedCount: 0, checkedCount: 0 });
      return;
    }

    const directions = getNeededDirections(flights);
    const providerResult = await fetchLiveFlights(directions);
    const liveByFlightCode = makeLiveIndex(providerResult.flights);
    const checkedAt = new Date().toISOString();
    let updatedCount = 0;

    const updatedFlights = flights.map((flight) => {
      const direction = isArrivalFlight(flight) ? 'arrival' : 'departure';
      const key = normalizeFlightCode(flight.flightNumber);
      const matches = (liveByFlightCode.get(key) ?? []).filter((match) => match.direction === direction);
      const bestMatch = matches[0];

      if (!bestMatch) {
        return flight;
      }

      const result = applyLiveFlight(flight, bestMatch, checkedAt);
      if (result.changed) {
        updatedCount += 1;
      }
      return result.flight;
    });

    if (updatedCount > 0) {
      await writeSharedBoard(updatedFlights, sharedBoard.filters, sharedBoard.arrivalStats);
    }

    res.status(200).json({
      flights: updatedFlights,
      updatedCount,
      checkedCount: providerResult.flights.length,
      provider: providerResult.source,
      fallbackUsed: providerResult.fallbackUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live sync failed';
    res.status(500).json({ error: message });
  }
}
