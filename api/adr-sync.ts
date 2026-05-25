import { get, put } from '@vercel/blob';
import type { Flight } from '../src/types';

type AdrDirection = 'departure' | 'arrival';

type AdrFlight = {
  flightCodes: string[];
  destination: string;
  scheduledTime: string;
  effectiveTime: string;
  terminal: string;
  status: string;
  direction: AdrDirection;
};

type SharedBoardPayload = {
  flights?: Flight[];
  filters?: unknown;
};

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOBV1_READ_WRITE_TOKEN;
const SHARED_BOARD_BLOB_PATH = 'partenze-manager/shared-board.json';
const ADR_BASE_URL = 'https://www.adr.it/pax-fco-voli-in-tempo-reale';
const ROME_TIME_ZONE = 'Europe/Rome';

const decodeHtml = (value: string) => value
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&agrave;/g, 'à')
  .replace(/&egrave;/g, 'è')
  .replace(/&eacute;/g, 'é')
  .replace(/&igrave;/g, 'ì')
  .replace(/&ograve;/g, 'ò')
  .replace(/&ugrave;/g, 'ù')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

const stripTags = (value: string) =>
  decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

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
  const match = compact.match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  return match ? `${match[1]}${match[2]}` : compact;
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

const getRomeHour = (date: Date) => {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROME_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);

  return Number(hour);
};

const toRomeLocalDateTime = (dateKey: string, hhmm: string) => `${dateKey}T${hhmm}:00`;

const getFlightDateKey = (flight: Flight) => {
  const date = new Date(flight.std);
  return Number.isNaN(date.getTime()) ? flight.std.slice(0, 10) : formatRomeDate(date);
};

const updateFlightStdTime = (flight: Flight, hhmm: string) => {
  const dateKey = getFlightDateKey(flight);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(hhmm)) {
    return flight.std;
  }

  return toRomeLocalDateTime(dateKey, hhmm);
};

const getRelevantIntervalsByDate = (flights: Flight[]) => {
  const intervalsByDate = new Map<string, Set<string>>();

  flights.forEach((flight) => {
    const date = new Date(flight.std);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const dateKey = formatRomeDate(date);
    const hour = getRomeHour(date);
    const baseStart = Math.max(0, Math.min(22, Math.floor(hour / 2) * 2));
    const starts = [baseStart - 2, baseStart, baseStart + 2].filter((start) => start >= 0 && start <= 22);

    if (!intervalsByDate.has(dateKey)) {
      intervalsByDate.set(dateKey, new Set());
    }

    starts.forEach((start) => {
      const end = start + 2;
      const label = `${String(start).padStart(2, '0')}:00-${String(end).padStart(2, '0')}:00`;
      intervalsByDate.get(dateKey)?.add(label);
    });
  });

  return intervalsByDate;
};

const buildAdrUrl = (direction: AdrDirection, dateKey: string, intervals: string[]) => {
  const params = new URLSearchParams();
  params.set('p_p_id', '3_WAR_realtimeflightsportlet');
  params.set('p_p_lifecycle', '0');
  params.set('p_p_state', 'normal');
  params.set('p_p_mode', 'view');
  params.set('_3_WAR_realtimeflightsportlet_tab', direction);
  params.set('_3_WAR_realtimeflightsportlet_codScaOpe', 'FCO');
  params.set('_3_WAR_realtimeflightsportlet_rouIata', '');
  params.set('_3_WAR_realtimeflightsportlet_isParent', 'false');
  params.set('_3_WAR_realtimeflightsportlet_airportId', '0');
  params.set('_3_WAR_realtimeflightsportlet_searchType', 'standard');
  params.set('_3_WAR_realtimeflightsportlet_airport', '');
  params.set('_3_WAR_realtimeflightsportlet_date', dateKey);
  intervals.forEach((interval) => params.append('_3_WAR_realtimeflightsportlet_orario', interval));
  params.set('_3_WAR_realtimeflightsportlet_codVet', '');
  params.set('_3_WAR_realtimeflightsportlet_carrier', '');
  params.set('_3_WAR_realtimeflightsportlet_rtFlightsSearchContainerPrimaryKeys', '');

  return `${ADR_BASE_URL}?${params.toString()}`;
};

const parseAdrRows = (html: string, direction: AdrDirection): AdrFlight[] => {
  const rows = html.match(/<tr\b[^>]*data-qa-id="row"[\s\S]*?<\/tr>/g) ?? [];

  return rows.map((row) => {
    const scheduledTime = stripTags(row.match(/date-estimated__time[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const effectiveTime = stripTags(row.match(/date-actual__time[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const destinationText = stripTags(row.match(/card-fg__dest[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? '');
    const destination = destinationText.match(/\(([A-Z]{3})\)/)?.[1] ?? '';
    const terminal = stripTags(row.match(/terminal-icon[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const status = stripTags(row.match(/card-fg__arrivals[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? '');
    const flightCodes = Array.from(row.matchAll(/<strong>\s*([A-Z0-9]{2,3}\s*\d{1,4}[A-Z]?)\s*<\/strong>/g))
      .map((match) => stripTags(match[1]))
      .filter(Boolean);

    return {
      flightCodes,
      destination,
      scheduledTime,
      effectiveTime,
      terminal,
      status,
      direction,
    };
  }).filter((flight) => flight.flightCodes.length > 0 && Boolean(flight.scheduledTime || flight.effectiveTime));
};

const fetchAdrFlights = async (direction: AdrDirection, dateKey: string, intervals: string[]) => {
  const response = await fetch(buildAdrUrl(direction, dateKey, intervals), {
    headers: {
      'User-Agent': 'Mozilla/5.0 PartenzeManager/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`ADR ${direction} request failed: ${response.status}`);
  }

  return parseAdrRows(await response.text(), direction);
};

const readSharedBoard = async (): Promise<SharedBoardPayload> => {
  const blob = await get(SHARED_BOARD_BLOB_PATH, {
    access: 'private',
    token: blobToken,
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200) {
    return { flights: [] };
  }

  const rawText = await new Response(blob.stream).text();
  if (!rawText.trim()) {
    return { flights: [] };
  }

  const parsed = JSON.parse(rawText) as SharedBoardPayload | Flight[];
  return Array.isArray(parsed)
    ? { flights: parsed }
    : { flights: Array.isArray(parsed.flights) ? parsed.flights : [], filters: parsed.filters };
};

const writeSharedBoard = async (flights: Flight[], filters: unknown) => {
  await put(
    SHARED_BOARD_BLOB_PATH,
    JSON.stringify({ flights, filters }),
    {
      access: 'private',
      token: blobToken,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: 'application/json',
    },
  );
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!blobToken) {
    res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });
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

    const intervalsByDate = getRelevantIntervalsByDate(flights);
    const adrFlights: AdrFlight[] = [];

    for (const [dateKey, intervals] of intervalsByDate.entries()) {
      const dateIntervals = Array.from(intervals);
      adrFlights.push(...await fetchAdrFlights('departure', dateKey, dateIntervals));
    }

    const adrByFlightCode = new Map<string, AdrFlight[]>();
    adrFlights.forEach((adrFlight) => {
      adrFlight.flightCodes.forEach((flightCode) => {
        const key = normalizeFlightCode(flightCode);
        adrByFlightCode.set(key, [...(adrByFlightCode.get(key) ?? []), adrFlight]);
      });
    });

    let updatedCount = 0;
    const updatedFlights = flights.map((flight) => {
      const key = normalizeFlightCode(flight.flightNumber);
      const matches = adrByFlightCode.get(key) ?? [];
      const destination = flight.destination.trim().toUpperCase();
      const bestMatch = matches.find((match) => match.destination === destination) ?? matches[0];

      if (!bestMatch) {
        return flight;
      }

      const adrTime = bestMatch.effectiveTime || bestMatch.scheduledTime;
      const nextStd = updateFlightStdTime(flight, adrTime);
      if (nextStd === flight.std) {
        return flight;
      }

      updatedCount += 1;
      return {
        ...flight,
        std: nextStd,
      };
    });

    if (updatedCount > 0) {
      await writeSharedBoard(updatedFlights, sharedBoard.filters);
    }

    res.status(200).json({
      flights: updatedFlights,
      updatedCount,
      checkedCount: adrFlights.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ADR sync failed';
    res.status(500).json({ error: message });
  }
}
