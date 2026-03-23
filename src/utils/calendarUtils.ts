import { Flight } from '../types';
import { getIataCityName } from './iataLookup';

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

export const getCalendarExportFingerprint = (flight: Flight) =>
  JSON.stringify({
    flightNumber: flight.flightNumber.trim().toUpperCase(),
    destination: flight.destination.trim().toUpperCase(),
    position: flight.position.trim().toUpperCase(),
    std: flight.std,
    richiesta: flight.richiesta?.trim() ?? '',
    tot: flight.tot?.trim() ?? '',
  });

export const generateICS = async (flights: Flight[], options: CalendarExportOptions = {}): Promise<string> => {
  const events = await Promise.all(flights.map(async (f) => {
    const endDate = new Date(f.std);
    const startDate = new Date(endDate.getTime() - 40 * 60000);
    const destinationName = await getIataCityName(f.destination, 'it');
    const containerDetails = [f.richiesta, f.tot].filter(Boolean).join(' | ');

    const formatUtcDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const formatRomeLocalDate = (date: Date) =>
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

    return `BEGIN:VEVENT
UID:${f.id}@flight-tracker
DTSTAMP:${formatUtcDate(new Date())}
DTSTART;TZID=Europe/Rome:${formatRomeLocalDate(startDate)}
DTEND;TZID=Europe/Rome:${formatRomeLocalDate(endDate)}
SUMMARY:${getCalendarSummary(f, options.updatedFlightIds)}
DESCRIPTION:${[destinationName, containerDetails].filter(Boolean).join('\\n')}
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
  const destinationName = await getIataCityName(flight.destination, 'it');
  const containerDetails = [flight.richiesta, flight.tot].filter(Boolean).join(' | ');
  const description = [destinationName, containerDetails].filter(Boolean).join(' ');

  return [
    `Event title: ${getCalendarSummary(flight, options.updatedFlightIds)} | Date: ${dateLabel} | Start: ${formatLocalTime(startDate)} | End: ${formatLocalTime(endDate)}`,
    description ? `Event Description: ${description}` : '',
  ].filter(Boolean).join('\n');
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
