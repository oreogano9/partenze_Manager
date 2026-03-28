import { Flight } from '../types';
import { getPrinterTags, requiresContainerDamageCheck } from '../constants';
import { getIataLocationName } from './iataLookup';

type CalendarExportOptions = {
  updatedFlightIds?: Set<string>;
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatLocalTime = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const isToday = (date: Date) => {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

const isTomorrow = (date: Date) => {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
};

const getCalendarSummary = (flight: Flight, updatedFlightIds?: Set<string>) => {
  const positionLabel = flight.position.trim() || 'X';
  const baseSummary = `${positionLabel} - ${flight.destination} - ${flight.flightNumber}`;
  return updatedFlightIds?.has(flight.id) ? `*${baseSummary}` : baseSummary;
};

const compactFlightCode = (flightNumber: string) => flightNumber.toUpperCase().replace(/\s+/g, '');

const normalizeInlineToken = (value: string) => {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[()]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');

  const countCodeMatch = normalized.match(/^(\d+)\s+([A-Z]{1,4})$/);
  if (countCodeMatch) {
    return `${countCodeMatch[1]}${countCodeMatch[2]}`;
  }

  const transitMatch = normalized.match(/^(\d+)\s+([A-Z]{3}\/[A-Z0-9]+)$/);
  if (transitMatch) {
    return `${transitMatch[1]}${transitMatch[2]}`;
  }

  return normalized;
};

const splitTopLevelSegments = (request?: string) => {
  const raw = request?.trim() ?? '';
  if (!raw) {
    return [] as string[];
  }

  const normalized = raw.replace(/[+]/g, '-');
  const segments: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of normalized) {
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === '-' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    segments.push(trailing);
  }

  return segments;
};

const getCalendarDescription = async (flight: Flight) => {
  const endDate = new Date(flight.std);
  const startDate = new Date(endDate.getTime() - 40 * 60000);
  const destinationLocation = await getIataLocationName(flight.destination, 'it');
  const printerTags = getPrinterTags(flight);
  const requiresDamageCheck = requiresContainerDamageCheck(flight);
  const segments = splitTopLevelSegments(flight.richiesta);
  const transitSegments = segments
    .filter((segment) => segment.startsWith('(') && segment.endsWith(')'))
    .map((segment) => normalizeInlineToken(segment));
  const coreSegments = segments
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => normalizeInlineToken(segment));

  if (flight.tot?.trim()) {
    coreSegments.push(normalizeInlineToken(flight.tot));
  }

  const lines = [
    `${flight.position.trim() || 'X'} | ${flight.destination.trim().toUpperCase()} | ${compactFlightCode(flight.flightNumber)} | ${formatLocalTime(startDate)} - ${formatLocalTime(endDate)}`,
    destinationLocation || flight.destination,
    coreSegments.length > 0 ? coreSegments.join(' | ') : '',
    transitSegments.length > 0 ? transitSegments.join(' | ') : '',
    flight.fc?.trim() ? `FirstClass ${flight.fc.trim().toUpperCase()}` : '',
    printerTags.length > 0 ? printerTags.join(' | ') : '',
    requiresDamageCheck ? 'Check danni contenitori' : '',
  ].filter(Boolean);

  return lines.join('\n');
};

export const getCalendarExportFingerprint = (flight: Flight) =>
  JSON.stringify({
    flightNumber: flight.flightNumber.trim().toUpperCase(),
    destination: flight.destination.trim().toUpperCase(),
    position: flight.position.trim().toUpperCase(),
    std: flight.std,
    richiesta: flight.richiesta?.trim() ?? '',
    tot: flight.tot?.trim() ?? '',
    fc: flight.fc?.trim() ?? '',
  });

export const generateICS = async (flights: Flight[], options: CalendarExportOptions = {}): Promise<string> => {
  const events = await Promise.all(flights.map(async (f) => {
    const endDate = new Date(f.std);
    const startDate = new Date(endDate.getTime() - 40 * 60000);
    const description = await getCalendarDescription(f);

    const formatUtcDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const formatRomeLocalDate = (date: Date) =>
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

    return `BEGIN:VEVENT
UID:${f.id}@flight-tracker
DTSTAMP:${formatUtcDate(new Date())}
DTSTART;TZID=Europe/Rome:${formatRomeLocalDate(startDate)}
DTEND;TZID=Europe/Rome:${formatRomeLocalDate(endDate)}
SUMMARY:${getCalendarSummary(f, options.updatedFlightIds)}
DESCRIPTION:${description.replace(/\n/g, '\\n')}
END:VEVENT`;
  }));

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Flight Tracker//EN
CALSCALE:GREGORIAN
X-WR-TIMEZONE:Europe/Rome
${events.join('\n')}
END:VCALENDAR`;
};

export const downloadICS = async (flights: Flight[], options: CalendarExportOptions = {}) => {
  const content = await generateICS(flights, options);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'flights.ics');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
};

export const formatFlightForClipboard = async (flight: Flight, options: CalendarExportOptions = {}): Promise<string> => {
  const endDate = new Date(flight.std);
  const startDate = new Date(endDate.getTime() - 40 * 60000);
  const dateLabel = isToday(endDate) ? 'Today' : isTomorrow(endDate) ? 'Tomorrow' : formatLocalDate(endDate);
  const description = await getCalendarDescription(flight);

  return [
    `Event title: ${getCalendarSummary(flight, options.updatedFlightIds)} | Date: ${dateLabel} | Start: ${formatLocalTime(startDate)} | End: ${formatLocalTime(endDate)}`,
    `Event Description: ${description}`,
  ].join('\n');
};

export const formatFlightsForClipboard = async (flights: Flight[], options: CalendarExportOptions = {}): Promise<string> => {
  if (flights.length === 0) {
    return '';
  }

  const formattedFlights = await Promise.all(flights.map((flight) => formatFlightForClipboard(flight, options)));
  return formattedFlights.join('\n\n');
};

export const copyFlightsToClipboard = async (flights: Flight[], options: CalendarExportOptions = {}) => {
  const content = await formatFlightsForClipboard(flights, options);
  if (!content) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};
