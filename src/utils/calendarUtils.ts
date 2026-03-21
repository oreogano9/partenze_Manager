import { Flight } from '../types';

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

export const generateICS = (flights: Flight[]): string => {
  const events = flights.map(f => {
    const startDate = new Date(f.std);
    const endDate = new Date(startDate.getTime() + 60 * 60000); // Assume 1 hour duration
    
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    return `BEGIN:VEVENT
UID:${f.id}@flight-tracker
DTSTAMP:${formatDate(new Date())}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${f.position} - ${f.destination} - ${f.flightNumber}
DESCRIPTION:Terminal: ${f.terminal}\\nPosition: ${f.position}\\nTags: ${f.tags.join(', ')}
LOCATION:${f.terminal} - ${f.position}
END:VEVENT`;
  }).join('\n');

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Flight Tracker//EN
${events}
END:VCALENDAR`;
};

export const downloadICS = (flights: Flight[]) => {
  const content = generateICS(flights);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'flights.ics');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const formatFlightForClipboard = (flight: Flight): string => {
  const endDate = new Date(flight.std);
  const startDate = new Date(endDate.getTime() - 60 * 60000);
  const dateLabel = isToday(endDate) ? 'Today' : formatLocalDate(endDate);
  const positionLabel = flight.position.trim() || 'X';

  return `Event title: ${positionLabel} - ${flight.destination} - ${flight.flightNumber} | Date: ${dateLabel} | Start: ${formatLocalTime(startDate)} | End: ${formatLocalTime(endDate)}`;
};

export const formatFlightsForClipboard = (flights: Flight[]): string => {
  if (flights.length === 0) {
    return '';
  }

  return `Add these as separate google calendar events for today:\n${flights.map(formatFlightForClipboard).join('\n')}`;
};

export const copyFlightsToClipboard = async (flights: Flight[]) => {
  const content = formatFlightsForClipboard(flights);
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
