import { Flight } from '../types';
import { getIataCityName } from './iataLookup';

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

export const generateICS = async (flights: Flight[]): Promise<string> => {
  const events = await Promise.all(flights.map(async (f) => {
    const endDate = new Date(f.std);
    const startDate = new Date(endDate.getTime() - 40 * 60000);
    const positionLabel = f.position.trim() || 'X';
    const destinationName = await getIataCityName(f.destination, 'it');
    const containerDetails = [f.richiesta, f.tot].filter(Boolean).join(' | ');
    
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    return `BEGIN:VEVENT
UID:${f.id}@flight-tracker
DTSTAMP:${formatDate(new Date())}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${positionLabel} - ${f.destination} - ${f.flightNumber}
DESCRIPTION:${[destinationName, containerDetails].filter(Boolean).join('\\n')}
END:VEVENT`;
  }));

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Flight Tracker//EN
${events.join('\n')}
END:VCALENDAR`;
};

export const downloadICS = async (flights: Flight[]) => {
  const content = await generateICS(flights);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'flights.ics');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const formatFlightForClipboard = async (flight: Flight): Promise<string> => {
  const endDate = new Date(flight.std);
  const startDate = new Date(endDate.getTime() - 40 * 60000);
  const dateLabel = isToday(endDate) ? 'Today' : isTomorrow(endDate) ? 'Tomorrow' : formatLocalDate(endDate);
  const positionLabel = flight.position.trim() || 'X';
  const destinationName = await getIataCityName(flight.destination, 'it');
  const containerDetails = [flight.richiesta, flight.tot].filter(Boolean).join(' | ');
  const description = [destinationName, containerDetails].filter(Boolean).join(' ');

  return [
    `Event title: ${positionLabel} - ${flight.destination} - ${flight.flightNumber} | Date: ${dateLabel} | Start: ${formatLocalTime(startDate)} | End: ${formatLocalTime(endDate)}`,
    description ? `Event Description: ${description}` : '',
  ].filter(Boolean).join('\n');
};

export const formatFlightsForClipboard = async (flights: Flight[]): Promise<string> => {
  if (flights.length === 0) {
    return '';
  }

  const formattedFlights = await Promise.all(flights.map(formatFlightForClipboard));
  return formattedFlights.join('\n\n');
};

export const copyFlightsToClipboard = async (flights: Flight[]) => {
  const content = await formatFlightsForClipboard(flights);
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
