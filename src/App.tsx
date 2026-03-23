import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Flight, OCRFlightCandidate, OCRSourceType, PositionType } from './types';
import { MOCK_FLIGHTS, TRANSLATIONS, getPositionType } from './constants';
import { Clock } from './components/Clock';
import { FlightCard, FlightCardExpandedContent } from './components/FlightCard';
import { formatDuration, formatHHmm, getMinutesToTarget, getUrgencyColor } from './utils/timeUtils';
import { copyFlightsToClipboard, downloadICS, getCalendarExportFingerprint } from './utils/calendarUtils';
import { extractFlightsFromImage } from './services/ocrService';
import { getIataSearchIndex } from './utils/iataLookup';
import { Calendar as CalendarIcon, Plane, Search, X, Download, Copy, Camera, Loader2, ScanText, TriangleAlert, Square, CheckSquare, Plus, Clock as ClockIcon, ChevronDown, ChevronUp, Settings, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type OCRReviewFlight = OCRFlightCandidate & { selected: boolean };
type OCRReviewPreview = { previewUrl: string; fileName: string };
type OCRReviewState = { flights: OCRReviewFlight[]; text: string; previews: OCRReviewPreview[] };
type MergeStatus = 'new' | 'update' | 'unchanged';
type MergeField = 'flightNumber' | 'destination' | 'std' | 'position';
type OCRMergeInfo = {
  status: MergeStatus;
  changedFields: Set<MergeField>;
  previousFlight: Flight | null;
};
type OcrSelectionPreset = 'All' | 'None' | PositionType;
const ALL_POSITION_TYPES: PositionType[] = ['Scivolo', 'Carosello', 'Baia'];
type PersistedState = {
  appState: AppState;
  terminalFilter: 'ALL' | 'T1' | 'T3';
  scanTerminal: 'T1' | 'T3';
  connectionThreshold: 5 | 10;
};

type OCRPreviewCardProps = {
  flight: OCRReviewFlight;
  onToggle: (id: string) => void;
  onFieldChange: (id: string, field: 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position', value: string) => void;
  t: any;
  language: 'it' | 'en';
  mergeInfo: OCRMergeInfo;
  canImport: boolean;
};

type OcrRequiredField = 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position';

type OCRFixModalProps = {
  flight: OCRReviewFlight;
  onFieldChange: (id: string, field: OcrRequiredField, value: string) => void;
  onSkip: () => void;
  onAdd: () => void;
  t: any;
};

const normalizeFlightCode = (value: string) => {
  const compact = value.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  if (!match) {
    const salvageMatch = compact.match(/^([A-Z0-9]{2,3})([A-Z0-9]{1,5})$/);
    if (salvageMatch) {
      const repairedSuffix = salvageMatch[2]
        .replace(/[OQ]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5');
      if (/^\d{1,4}[A-Z]?$/.test(repairedSuffix)) {
        return `${salvageMatch[1]} ${repairedSuffix}`;
      }
    }

    return value.toUpperCase().trim().replace(/\s+/g, ' ');
  }
  return `${match[1]} ${match[2]}`;
};

const getFlightCodeKey = (flightNumber: string) => normalizeFlightCode(flightNumber).replace(/\s+/g, '');

const isValidOcrStd = (std: string) => !Number.isNaN(new Date(std).getTime());
const isUnassignedPosition = (position: string) => {
  const normalized = position.trim();
  return normalized === '/' || normalized === '\\';
};
const hasValidRequiredPosition = (position: string) => Boolean(position.trim() || isUnassignedPosition(position));
const isOcrFlightComplete = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position'>) =>
  Boolean(
    getFlightCodeKey(flight.flightNumber) &&
    flight.destination.trim() &&
    hasValidRequiredPosition(flight.position) &&
    (flight.terminal === 'T1' || flight.terminal === 'T3') &&
    isValidOcrStd(flight.std)
  );

const getFirstMissingOcrField = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position'>): OcrRequiredField | null => {
  if (!getFlightCodeKey(flight.flightNumber)) return 'flightNumber';
  if (!flight.destination.trim()) return 'destination';
  if (!isValidOcrStd(flight.std)) return 'std';
  if (!(flight.terminal === 'T1' || flight.terminal === 'T3')) return 'terminal';
  if (!hasValidRequiredPosition(flight.position)) return 'position';
  return null;
};

const updateStdTime = (existingStd: string, hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return existingStd;
  }

  const nextDate = new Date(existingStd);
  if (Number.isNaN(nextDate.getTime())) {
    const fallback = new Date();
    fallback.setHours(hours, minutes, 0, 0);
    return fallback.toISOString();
  }

  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate.toISOString();
};

const getFlightMatchKey = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal'>) => {
  const date = new Date(flight.std);
  const localDay = Number.isNaN(date.getTime()) ? flight.std.slice(0, 10) : date.toLocaleDateString('sv-SE');
  const time = Number.isNaN(date.getTime()) ? flight.std : formatHHmm(flight.std);
  return [
    normalizeFlightCode(flight.flightNumber),
    flight.destination.trim().toUpperCase(),
    flight.terminal.trim().toUpperCase(),
    localDay,
    time,
  ].join('|');
};

const getFlightCodeOnlyKey = (flight: Pick<Flight, 'flightNumber'>) => getFlightCodeKey(flight.flightNumber);

const pickPreferredValue = (current?: string, incoming?: string) => {
  const currentValue = current?.trim() ?? '';
  const incomingValue = incoming?.trim() ?? '';

  if (!incomingValue) return currentValue;
  if (!currentValue) return incomingValue;
  if (incomingValue.length > currentValue.length) return incomingValue;
  if (incomingValue.length === currentValue.length && incomingValue !== currentValue) return incomingValue;
  return currentValue;
};

const mergeFlightData = <T extends Flight>(base: T, incoming: Partial<T>): T => ({
  ...base,
  importedAt: base.importedAt || incoming.importedAt,
  calendarExportedAt: base.calendarExportedAt,
  calendarExportFingerprint: base.calendarExportFingerprint,
  carrier: pickPreferredValue(base.carrier, incoming.carrier) || undefined,
  flightNumberNumeric: pickPreferredValue(base.flightNumberNumeric, incoming.flightNumberNumeric) || undefined,
  flightNumber: normalizeFlightCode(pickPreferredValue(base.flightNumber, incoming.flightNumber) || base.flightNumber),
  destination: pickPreferredValue(base.destination, incoming.destination) || base.destination,
  std: incoming.std?.trim() ? incoming.std : base.std,
  terminal: incoming.terminal || base.terminal,
  position: pickPreferredValue(base.position, incoming.position) || base.position,
  fc: pickPreferredValue(base.fc, incoming.fc) || undefined,
  richiesta: pickPreferredValue(base.richiesta, incoming.richiesta) || undefined,
  tot: pickPreferredValue(base.tot, incoming.tot) || undefined,
  anomaly: pickPreferredValue(base.anomaly, incoming.anomaly) || undefined,
  bag: pickPreferredValue(base.bag, incoming.bag) || undefined,
});

const findMatchingFlightIndex = <T extends Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal'> & { sourceType?: OCRSourceType }>(
  flights: T[],
  incoming: T,
) => {
  const exactKey = getFlightMatchKey(incoming);
  const exactIndex = flights.findIndex((flight) => getFlightMatchKey(flight) === exactKey);
  if (exactIndex !== -1) {
    return exactIndex;
  }

  const codeKey = getFlightCodeOnlyKey(incoming);
  if (!codeKey) {
    return -1;
  }

  return flights.findIndex((flight) => getFlightCodeOnlyKey(flight) === codeKey);
};

const findMatchingFlight = (
  flights: Flight[],
  incoming: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal'> & { sourceType?: OCRSourceType },
) => {
  const exactKey = getFlightMatchKey(incoming);
  const exactMatch = flights.find((flight) => getFlightMatchKey(flight) === exactKey);
  if (exactMatch) {
    return exactMatch;
  }

  const codeKey = getFlightCodeOnlyKey(incoming);
  if (!codeKey) {
    return null;
  }

  return flights.find((flight) => getFlightCodeOnlyKey(flight) === codeKey) ?? null;
};

const getComparableStd = (std: string) => {
  const date = new Date(std);
  return Number.isNaN(date.getTime()) ? std : formatHHmm(std);
};

const getOcrMergeInfo = (flight: OCRReviewFlight, existingFlights: Flight[]): OCRMergeInfo => {
  const existingFlight = findMatchingFlight(existingFlights, flight);
  if (!existingFlight) {
    return { status: 'new', changedFields: new Set(), previousFlight: null };
  }

  const changedFields = new Set<MergeField>();

  if (normalizeFlightCode(flight.flightNumber) !== normalizeFlightCode(existingFlight.flightNumber)) {
    changedFields.add('flightNumber');
  }
  if (flight.destination.trim() && flight.destination.trim().toUpperCase() !== existingFlight.destination.trim().toUpperCase()) {
    changedFields.add('destination');
  }
  if (flight.position.trim() && flight.position.trim().toUpperCase() !== existingFlight.position.trim().toUpperCase()) {
    changedFields.add('position');
  }
  if (getComparableStd(flight.std) !== getComparableStd(existingFlight.std)) {
    changedFields.add('std');
  }

  return {
    status: changedFields.size === 0 ? 'unchanged' : 'update',
    changedFields,
    previousFlight: existingFlight,
  };
};

const canImportOcrFlight = (flight: OCRReviewFlight, existingFlights: Flight[]) => {
  if (isOcrFlightComplete(flight)) {
    return true;
  }

  if (flight.sourceType !== 'bay_screen') {
    return false;
  }

  return Boolean(
    getFlightCodeOnlyKey(flight) &&
    hasValidRequiredPosition(flight.position) &&
    isValidOcrStd(flight.std) &&
    (flight.terminal === 'T1' || flight.terminal === 'T3') &&
    existingFlights.some((existingFlight) => getFlightCodeOnlyKey(existingFlight) === getFlightCodeOnlyKey(flight)),
  );
};

const mergeOcrFlightLists = (existing: OCRReviewFlight[], incoming: OCRReviewFlight[]) => {
  const merged = [...existing];

  incoming.forEach((flight) => {
    const existingIndex = findMatchingFlightIndex(merged, flight);

    if (existingIndex === -1) {
      merged.push(flight);
      return;
    }

    const current = merged[existingIndex];
    merged[existingIndex] = {
      ...mergeFlightData(current, flight),
      confidence: Math.max(current.confidence, flight.confidence),
      sourceLine: pickPreferredValue(current.sourceLine, flight.sourceLine),
      crossedOut: current.crossedOut || flight.crossedOut || undefined,
      sourceType: current.sourceType || flight.sourceType,
      selected: current.selected && !flight.crossedOut,
    };
  });

  return merged.sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime());
};

const mergeIntoBoardFlights = (existingFlights: Flight[], incomingFlights: OCRReviewFlight[]) => {
  const mergedFlights = [...existingFlights];

  incomingFlights.forEach((flight) => {
    const existingIndex = findMatchingFlightIndex(mergedFlights, flight);

    if (existingIndex === -1) {
      mergedFlights.push(flight);
      return;
    }

    mergedFlights[existingIndex] = mergeFlightData(mergedFlights[existingIndex], flight);
  });

  return mergedFlights;
};

const SCAN_LOADING_MESSAGES = [
  'Analizzo la foto...',
  'Cerco voli e orari...',
  'Estraggo i dati principali...',
  'Verifico terminal e posizione...',
  'Preparo l\'importazione...',
] as const;

const SHIFT_TIME_OPTIONS = Array.from({length: 48}, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, '0');
  const minutes = index % 2 === 0 ? '00' : '30';
  return `${hours}:${minutes}`;
});

const roundToNearestHalfHour = (date: Date) => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const snappedMinutes = minutes <= 15 ? 0 : minutes <= 45 ? 30 : 60;
  rounded.setMinutes(snappedMinutes, 0, 0);
  return rounded;
};

const formatTimeOption = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const PERSISTED_STATE_KEY = 'partenze-manager-state';
const IMPORTED_FLIGHT_TTL_MS = 14 * 60 * 60 * 1000;
const DEFAULT_APP_STATE: AppState = {
  flights: MOCK_FLIGHTS,
  language: 'it',
  showPast: false,
  filterTypes: ALL_POSITION_TYPES,
  searchQuery: '',
  showFocusOnly: false,
  showMockFlights: false,
};

const resolveShiftEnd = (start: string, end: string) => {
  const now = new Date();
  const [startHours, startMinutes] = start.split(':').map(Number);
  const [endHours, endMinutes] = end.split(':').map(Number);
  const shiftStart = new Date(now);
  shiftStart.setHours(startHours, startMinutes, 0, 0);
  const shiftEnd = new Date(now);
  shiftEnd.setHours(endHours, endMinutes, 0, 0);

  if (shiftEnd.getTime() <= shiftStart.getTime()) {
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }

  return shiftEnd;
};

const isImportedFlightExpired = (flight: Flight) => {
  if (!flight.id.startsWith('ocr-') || !flight.importedAt) {
    return false;
  }

  const importedAt = new Date(flight.importedAt).getTime();
  if (Number.isNaN(importedAt)) {
    return false;
  }

  return Date.now() - importedAt >= IMPORTED_FLIGHT_TTL_MS;
};

const pruneExpiredImportedFlights = (flights: Flight[]) =>
  flights.filter((flight) => !isImportedFlightExpired(flight));

const loadPersistedState = (): PersistedState => {
  const defaultShiftStart = formatTimeOption(roundToNearestHalfHour(new Date()));
  const defaultShiftEndDate = new Date();
  defaultShiftEndDate.setTime(roundToNearestHalfHour(new Date()).getTime() + 8 * 60 * 60000);
  const defaultShiftEnd = formatTimeOption(defaultShiftEndDate);
  const fallback: PersistedState = {
    appState: DEFAULT_APP_STATE,
    terminalFilter: 'ALL',
    scanTerminal: 'T1',
    connectionThreshold: 10,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const persistedFlights = pruneExpiredImportedFlights(parsed.appState?.flights ?? DEFAULT_APP_STATE.flights)
      .map((flight) => ({
        ...flight,
        flightNumber: normalizeFlightCode(flight.flightNumber),
      }));
    const legacyFilterType = (parsed.appState as AppState & { filterType?: PositionType | 'All' } | undefined)?.filterType;
    const persistedFilterTypes = Array.isArray(parsed.appState?.filterTypes)
      ? parsed.appState.filterTypes.filter((type): type is PositionType => ALL_POSITION_TYPES.includes(type as PositionType))
      : legacyFilterType && legacyFilterType !== 'All'
        ? [legacyFilterType]
        : ALL_POSITION_TYPES;
    return {
      appState: {
        ...DEFAULT_APP_STATE,
        ...parsed.appState,
        flights: persistedFlights,
        filterTypes: persistedFilterTypes,
      },
      terminalFilter: parsed.terminalFilter === 'T1' || parsed.terminalFilter === 'T3' ? parsed.terminalFilter : 'ALL',
      scanTerminal: parsed.scanTerminal === 'T3' ? 'T3' : 'T1',
      connectionThreshold: parsed.connectionThreshold === 5 ? 5 : 10,
    };
  } catch (error) {
    console.error('Failed to load persisted state', error);
    return fallback;
  }
};

const OCRPreviewCard: React.FC<OCRPreviewCardProps> = ({flight, onToggle, onFieldChange, t, language, mergeInfo, canImport}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showChangeDetails, setShowChangeDetails] = useState(false);
  const minutesToTarget = getMinutesToTarget(flight.std);
  const minutesToSTD = Math.floor((new Date(flight.std).getTime() - Date.now()) / 60000);
  const urgencyColor = getUrgencyColor(minutesToSTD);
  const stdCountdown = formatDuration(minutesToSTD);
  const posType = getPositionType(flight.terminal, flight.position);
  const { status: mergeStatus, changedFields, previousFlight } = mergeInfo;
  let statusLabel = `${minutesToTarget}m`;
  let labelClass = 'text-white/40';

  if (minutesToSTD <= 0) {
    statusLabel = 'In uscita';
    labelClass = 'bg-gray-600 text-white';
  } else if (minutesToSTD <= 40) {
    statusLabel = 'In uscita';
    labelClass = 'bg-red-600 text-white';
  } else if (minutesToSTD <= 60) {
    statusLabel = 'In chiusura';
    labelClass = 'bg-amber-600 text-white';
  }

  const changeRows = previousFlight ? [
    changedFields.has('flightNumber') ? { label: t.flightNumberLabel, before: previousFlight.flightNumber || '—', after: flight.flightNumber || '—' } : null,
    changedFields.has('destination') ? { label: t.destinationLabel, before: previousFlight.destination || '—', after: flight.destination || '—' } : null,
    changedFields.has('position') ? { label: t.positionLabel, before: previousFlight.position || '—', after: flight.position || '—' } : null,
    changedFields.has('std') ? { label: t.std, before: formatHHmm(previousFlight.std), after: formatHHmm(flight.std) } : null,
  ].filter(Boolean) as Array<{label: string; before: string; after: string}> : [];

  return (
    <motion.div
      layout
      className={`rounded-xl border shadow-lg relative overflow-visible ${
        mergeStatus === 'unchanged'
          ? 'border-pink-400/25 bg-[#1a1a1a]'
          : flight.selected
            ? 'border-emerald-500/20 bg-[#1a1a1a]'
            : 'border-white/8 bg-[#141414] opacity-70'
      } ${isExpanded ? 'z-30' : 'z-0'}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-4 flex-1 min-w-0 cursor-pointer" onClick={() => setIsExpanded(prev => !prev)}>
          <div
            className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center text-white font-bold shadow-lg shrink-0 ${
              changedFields.has('position') ? 'ring-2 ring-amber-300/80 ring-offset-2 ring-offset-[#1a1a1a]' : ''
            }`}
            style={{ backgroundColor: urgencyColor }}
          >
            <span className="text-2xl leading-none">{flight.position || 'X'}</span>
            <span className={`text-[14px] font-black uppercase mt-0.5 ${changedFields.has('destination') ? 'text-amber-100' : ''}`}>{flight.destination}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-bold text-[15px] leading-tight ${changedFields.has('flightNumber') ? 'text-amber-200' : 'text-white'} break-words`}>{flight.flightNumber}</span>
              {!canImport && (
                <span className="rounded-full border border-amber-400/20 bg-amber-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-100">
                  {t.requiredFieldsMissing}
                </span>
              )}
              {flight.crossedOut && (
                <span className="rounded-full border border-rose-400/20 bg-rose-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-200">
                  {t.crossedOut}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                  mergeStatus === 'unchanged'
                    ? 'border border-pink-400/30 bg-pink-500/15 text-pink-200'
                    : mergeStatus === 'update'
                    ? 'border border-blue-400/20 bg-blue-500/15 text-blue-200'
                    : 'border border-emerald-400/20 bg-emerald-500/15 text-emerald-200'
                }`}
              >
                {mergeStatus === 'unchanged' ? t.alreadyPresent : mergeStatus === 'update' ? t.updatesExisting : t.newFlight}
              </span>
              {mergeStatus === 'update' && changeRows.length > 0 && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowChangeDetails((prev) => !prev);
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all ${
                    showChangeDetails
                      ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                      : 'border-white/10 text-white/60 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <ClockIcon size={10} />
                  {t.beforeAfter}
                </button>
              )}
            </div>

            {(flight.fc || flight.richiesta || flight.tot) && !isExpanded && (
              <div className="mt-1 text-[9px] leading-tight break-words">
                {flight.fc && <span className="text-white/70 font-black mr-1.5">{flight.fc}</span>}
                {flight.richiesta && <span className="text-white/60 font-medium italic mr-1.5">{flight.richiesta}</span>}
                {flight.tot && <span className="text-white/30 font-bold">{flight.tot}</span>}
              </div>
            )}

            <div className="mt-2 flex items-center gap-4 text-[10px] text-white/50">
              <div className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${changedFields.has('std') ? 'bg-amber-500/10 text-amber-200' : ''}`}>
                <ClockIcon size={10} />
                <span>STD: {formatHHmm(flight.std)}</span>
              </div>
            </div>
            {showChangeDetails && changeRows.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/5 p-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/80">
                  {t.beforeAfterDetails}
                </div>
                <div className="space-y-1.5">
                  {changeRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[64px_minmax(0,1fr)_12px_minmax(0,1fr)] items-center gap-2 text-[10px]">
                      <span className="font-bold uppercase tracking-wider text-white/35">{row.label}</span>
                      <span className="truncate rounded-md border border-white/5 bg-black/20 px-2 py-1 text-white/55">{row.before}</span>
                      <span className="text-center text-amber-200">→</span>
                      <span className="truncate rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 font-bold text-amber-100">{row.after}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end justify-center gap-1 shrink-0">
          <button
            onClick={() => onToggle(flight.id)}
            className="rounded-xl p-2 text-white/30 transition-all hover:bg-white/5 hover:text-white"
          >
            {flight.selected ? <CheckSquare size={18} className="text-emerald-300" /> : <Square size={18} />}
          </button>
          <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${labelClass}`}>
            {statusLabel}
          </div>
          <div className="text-[18px] font-black tracking-tighter font-mono leading-none" style={{ color: urgencyColor }}>
            {stdCountdown}
          </div>
          {isExpanded ? <ChevronUp className="text-white/20" size={18} /> : <ChevronDown className="text-white/20" size={18} />}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 bg-black/20 overflow-visible"
          >
            <FlightCardExpandedContent
              flight={flight}
              posType={posType}
              t={t}
              language={language}
              confidence={flight.confidence}
            />
            <div className="border-t border-white/5 bg-white/[0.02] p-4">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                {t.requiredFields}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={flight.flightNumber}
                  onChange={(event) => onFieldChange(flight.id, 'flightNumber', event.target.value.toUpperCase())}
                  placeholder={t.flightNumberLabel}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                />
                <input
                  value={flight.destination}
                  onChange={(event) => onFieldChange(flight.id, 'destination', event.target.value.toUpperCase())}
                  placeholder={t.destinationLabel}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white uppercase outline-none"
                />
                <input
                  value={formatHHmm(flight.std)}
                  onChange={(event) => onFieldChange(flight.id, 'std', event.target.value)}
                  placeholder="HH:mm"
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                />
                <input
                  value={flight.position}
                  onChange={(event) => onFieldChange(flight.id, 'position', event.target.value.toUpperCase())}
                  placeholder={t.positionLabel}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white uppercase outline-none"
                />
                <div className="sm:col-span-2 flex rounded-xl border border-white/10 bg-black/20 p-1">
                  {(['T1', 'T3'] as const).map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => onFieldChange(flight.id, 'terminal', term)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                        flight.terminal === term ? 'bg-emerald-500 text-black' : 'text-white/50 hover:text-white'
                      }`}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const OCRFixModal: React.FC<OCRFixModalProps> = ({ flight, onFieldChange, onSkip, onAdd, t }) => {
  const firstMissingField = getFirstMissingOcrField(flight);
  const flightNumberRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const stdRef = useRef<HTMLInputElement>(null);
  const positionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const target =
      firstMissingField === 'flightNumber' ? flightNumberRef.current :
      firstMissingField === 'destination' ? destinationRef.current :
      firstMissingField === 'std' ? stdRef.current :
      firstMissingField === 'position' ? positionRef.current :
      null;

    if (!target) {
      return;
    }

    const timer = window.setTimeout(() => {
      target.focus();
      target.select();
    }, 60);

    return () => window.clearTimeout(timer);
  }, [firstMissingField, flight.id]);

  const getInputClassName = (field: OcrRequiredField) =>
    `rounded-xl border px-3 py-3 text-sm font-bold text-white outline-none transition-all ${
      firstMissingField === field
        ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/40'
        : 'border-white/10 bg-black/20'
    }`;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#111111] shadow-2xl">
        <div className="border-b border-white/5 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-300">{t.fixBeforeImport}</p>
          <p className="mt-2 text-sm text-white/55">{t.fixBeforeImportHint}</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-white/10 text-white">
                <span className="text-2xl font-black leading-none">{flight.position || 'X'}</span>
                <span className="mt-1 text-sm font-black uppercase leading-none">{flight.destination || '---'}</span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-black text-white">{flight.flightNumber || '---'}</div>
                <div className="mt-1 text-xs text-white/45">STD: {isValidOcrStd(flight.std) ? formatHHmm(flight.std) : '--:--'}</div>
                <div className="mt-1 text-xs font-bold uppercase text-white/35">{flight.terminal || 'T1'}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <input
              ref={flightNumberRef}
              value={flight.flightNumber}
              onChange={(event) => onFieldChange(flight.id, 'flightNumber', event.target.value.toUpperCase())}
              placeholder={t.flightNumberLabel}
              className={getInputClassName('flightNumber')}
            />
            <input
              ref={destinationRef}
              value={flight.destination}
              onChange={(event) => onFieldChange(flight.id, 'destination', event.target.value.toUpperCase())}
              placeholder={t.destinationLabel}
              className={`${getInputClassName('destination')} uppercase`}
            />
            <input
              ref={stdRef}
              value={formatHHmm(flight.std)}
              onChange={(event) => onFieldChange(flight.id, 'std', event.target.value)}
              placeholder="HH:mm"
              className={getInputClassName('std')}
            />
            <input
              ref={positionRef}
              value={flight.position}
              onChange={(event) => onFieldChange(flight.id, 'position', event.target.value.toUpperCase())}
              placeholder={t.positionLabel}
              className={`${getInputClassName('position')} uppercase`}
            />
            <div className={`flex rounded-xl border p-1 ${
              firstMissingField === 'terminal'
                ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/40'
                : 'border-white/10 bg-black/20'
            }`}>
              {(['T1', 'T3'] as const).map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => onFieldChange(flight.id, 'terminal', term)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                    flight.terminal === term ? 'bg-emerald-500 text-black' : 'text-white/50 hover:text-white'
                  }`}
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-white/5 px-5 py-4">
          <button
            onClick={onSkip}
            className="flex-1 rounded-xl border border-white/10 px-3 py-3 text-sm font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
          >
            {t.skip}
          </button>
          <button
            onClick={onAdd}
            disabled={!isOcrFlightComplete(flight)}
            className="flex-1 rounded-xl bg-emerald-500 px-3 py-3 text-sm font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            {t.addThisFlight}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const defaultShiftStart = formatTimeOption(roundToNearestHalfHour(new Date()));
  const defaultShiftEndDate = new Date();
  defaultShiftEndDate.setTime(roundToNearestHalfHour(new Date()).getTime() + 8 * 60 * 60000);
  const defaultShiftEnd = formatTimeOption(defaultShiftEndDate);
  const persistedState = loadPersistedState();

  const [currentView, setCurrentView] = useState<'board' | 'settings'>('board');
  const [state, setState] = useState<AppState>(persistedState.appState);
  const [terminalFilter, setTerminalFilter] = useState<'ALL' | 'T1' | 'T3'>(persistedState.terminalFilter);
  const [scanTerminal, setScanTerminal] = useState<'T1' | 'T3'>(persistedState.scanTerminal);
  const [shiftStart, setShiftStart] = useState(defaultShiftStart);
  const [shiftEnd, setShiftEnd] = useState(defaultShiftEnd);
  const [useShiftFilter, setUseShiftFilter] = useState(true);
  const [connectionThreshold, setConnectionThreshold] = useState<5 | 10>(persistedState.connectionThreshold);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [showShiftMenu, setShowShiftMenu] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrReview, setOcrReview] = useState<OCRReviewState | null>(null);
  const [ocrReviewTypeFilter, setOcrReviewTypeFilter] = useState<'All' | PositionType>('All');
  const [ocrSelectionPreset, setOcrSelectionPreset] = useState<OcrSelectionPreset>('All');
  const [ocrFixFlightId, setOcrFixFlightId] = useState<string | null>(null);
  const [mobileOcrPanel, setMobileOcrPanel] = useState<'flights' | 'photo'>('flights');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [scanLoadingIndex, setScanLoadingIndex] = useState(0);
  const [iataSearchIndex, setIataSearchIndex] = useState<Map<string, string>>(new Map());
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const shiftMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const ocrReviewRef = useRef<OCRReviewState | null>(null);

  const t = TRANSLATIONS[state.language];

  useEffect(() => {
    let cancelled = false;

    getIataSearchIndex(state.language).then((index) => {
      if (!cancelled) {
        setIataSearchIndex(index);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [state.language]);

  const filteredFlights = useMemo(() => {
    const now = new Date();
    const query = state.searchQuery.toLowerCase();
    
    return state.flights
      .filter(f => {
        const isMockFlight = !f.id.startsWith('ocr-');
        const matchesMockVisibility = state.showMockFlights || !isMockFlight;
        const isPast = new Date(f.std) <= now;
        const matchesPast = state.showPast || !isPast;
        const posType = getPositionType(f.terminal, f.position);
        const matchesType = state.filterTypes.includes(posType);
        const matchesTerminal = terminalFilter === 'ALL' || f.terminal === terminalFilter;
        
        const destinationSearchText = iataSearchIndex.get(f.destination.trim().toUpperCase()) || '';
        const matchesSearch = !query || 
          f.flightNumber.toLowerCase().includes(query) ||
          f.destination.toLowerCase().includes(query) ||
          f.position.toLowerCase().includes(query) ||
          destinationSearchText.includes(query);

        const minutesToSTD = Math.floor((new Date(f.std).getTime() - Date.now()) / 60000);
        const isFocused = minutesToSTD >= 15 && minutesToSTD <= 90;
        const matchesFocus = !state.showFocusOnly || isFocused;
        const shiftEndDate = resolveShiftEnd(shiftStart, shiftEnd);
        const shiftLowerBound = new Date(Date.now() + 30 * 60000);
        const shiftUpperBound = new Date(shiftEndDate.getTime() + 60 * 60000);
        const flightTime = new Date(f.std);
        const matchesShift = !useShiftFilter || (flightTime >= shiftLowerBound && flightTime <= shiftUpperBound);

        return matchesMockVisibility && matchesPast && matchesType && matchesSearch && matchesTerminal && matchesFocus && matchesShift;
      })
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime());
  }, [state.flights, state.showPast, state.filterTypes, state.searchQuery, state.showFocusOnly, state.showMockFlights, terminalFilter, shiftStart, shiftEnd, useShiftFilter, iataSearchIndex]);

  const hasImportedFlights = useMemo(
    () => state.flights.some((flight) => flight.id.startsWith('ocr-')),
    [state.flights],
  );
  const shouldShowOnboardingEmptyState = filteredFlights.length === 0 && !hasImportedFlights;
  const shouldShowFilteredEmptyState = filteredFlights.length === 0 && hasImportedFlights;

  const handleTagToggle = (id: string, tag: string) => {
    setState(prev => ({
      ...prev,
      flights: prev.flights.map(f => {
        if (f.id !== id) return f;
        const tags = f.tags.includes(tag)
          ? f.tags.filter(t => t !== tag)
          : [...f.tags, tag];
        return { ...f, tags };
      })
    }));
  };

  const togglePast = () => {
    setState(prev => ({ ...prev, showPast: !prev.showPast }));
  };

  const clearLocalData = () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        state.language === 'it'
          ? 'Vuoi davvero cancellare tutti i dati salvati localmente? I dati demo resteranno disponibili.'
          : 'Do you want to delete all locally saved data? Dummy data will remain available.'
      );

      if (!confirmed) {
        return;
      }

      window.localStorage.removeItem(PERSISTED_STATE_KEY);
    }

    setState(DEFAULT_APP_STATE);
    setTerminalFilter('ALL');
    setScanTerminal('T1');
    setShiftStart(defaultShiftStart);
    setShiftEnd(defaultShiftEnd);
    setUseShiftFilter(true);
    setConnectionThreshold(10);
    setShowCalendarMenu(false);
    setShowScanMenu(false);
    setShowShiftMenu(false);
    setCurrentView('board');
    setCopyFeedback(null);
    setOcrError(null);
    closeOcrReview();
  };

  const closeOcrReview = () => {
    setOcrReviewTypeFilter('All');
    setOcrSelectionPreset('All');
    setOcrFixFlightId(null);
    setMobileOcrPanel('flights');
    setOcrReview(prev => {
      prev?.previews.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      return null;
    });
  };

  const toggleOcrCandidate = (id: string) => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        flights: prev.flights.map(flight => (
          flight.id === id ? {...flight, selected: !flight.selected} : flight
        )),
      };
    });
  };

  const updateOcrCandidateField = (id: string, field: 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position', value: string) => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        flights: prev.flights.map((flight) => {
          if (flight.id !== id) {
            return flight;
          }

          if (field === 'std') {
            return { ...flight, std: updateStdTime(flight.std, value) };
          }

          if (field === 'terminal') {
            return { ...flight, terminal: value === 'T3' ? 'T3' : 'T1' };
          }

          if (field === 'flightNumber') {
            return { ...flight, flightNumber: normalizeFlightCode(value) };
          }

          return { ...flight, [field]: value };
        }),
      };
    });
  };

  const toggleAllOcrCandidates = (selected: boolean) => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        flights: prev.flights.map(flight => ({...flight, selected: selected ? canImportOcrFlight(flight, state.flights) : false})),
      };
    });
    setOcrSelectionPreset(selected ? 'All' : 'None');
  };

  const setOcrSelectionByType = (type: PositionType) => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        flights: prev.flights.map(flight => ({
          ...flight,
          selected: getPositionType(flight.terminal, flight.position) === type && canImportOcrFlight(flight, state.flights),
        })),
      };
    });
    setOcrReviewTypeFilter(type);
    setOcrSelectionPreset(type);
  };

  const handleImportFlights = () => {
    if (!ocrReview) {
      return;
    }

    const selectedFlights = ocrReview.flights.filter(flight => flight.selected);
    if (selectedFlights.length === 0) {
      return;
    }

    const firstInvalidFlight = selectedFlights.find((flight) => !canImportOcrFlight(flight, state.flights));
    if (firstInvalidFlight) {
      setOcrError(null);
      setOcrFixFlightId(firstInvalidFlight.id);
      return;
    }

    const importedAt = new Date().toISOString();
    const finalizedFlights = selectedFlights.map((flight) => ({
      ...flight,
      flightNumber: normalizeFlightCode(flight.flightNumber),
      importedAt,
    }));

    setState(prev => ({
      ...prev,
      flights: pruneExpiredImportedFlights(mergeIntoBoardFlights(prev.flights, finalizedFlights)),
      searchQuery: '',
      showFocusOnly: false,
      filterTypes: ALL_POSITION_TYPES,
      showPast: true,
    }));
    setTerminalFilter('ALL');
    closeOcrReview();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setOcrError(null);
    setIsExtracting(true);
    setOcrProgress(0);

    try {
      const result = await extractFlightsFromImage(file, scanTerminal, progress => {
        setOcrProgress(progress);
      });

      const previewUrl = URL.createObjectURL(file);
      setOcrReview(prev => {
        const nextFlights = result.flights.map(flight => ({
          ...flight,
          flightNumber: normalizeFlightCode(flight.flightNumber),
          selected: new Date(flight.std).getTime() > Date.now() && !flight.crossedOut,
        }));

        if (!prev) {
          setOcrReviewTypeFilter('All');
          setOcrSelectionPreset('All');
          setMobileOcrPanel('flights');
          return {
            text: result.text,
            flights: nextFlights,
            previews: [{ previewUrl, fileName: file.name }],
          };
        }

        return {
          text: [prev.text, result.text].filter(Boolean).join('\n\n-----\n\n'),
          flights: mergeOcrFlightLists(prev.flights, nextFlights),
          previews: [...prev.previews, { previewUrl, fileName: file.name }],
        };
      });
    } catch (error) {
      console.error('OCR extraction failed', error);
      const message = error instanceof Error ? error.message : 'OCR failed on this image.';
      setOcrError(message);
    } finally {
      setIsExtracting(false);
      setOcrProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  };

  const handleCalendarExport = async (type: 'ics' | 'copy') => {
    if (filteredFlights.length === 0) return;

    const flightsToExport = filteredFlights.filter(
      (flight) => flight.calendarExportFingerprint !== getCalendarExportFingerprint(flight),
    );
    const updatedFlightIds = new Set<string>(
      flightsToExport
        .filter((flight) => Boolean(flight.calendarExportFingerprint))
        .map((flight) => flight.id),
    );

    if (flightsToExport.length === 0) {
      setCopyFeedback(t.noCalendarChangesToExport);
      setShowCalendarMenu(false);
      return;
    }

    try {
      let exportSucceeded = false;
      if (type === 'ics') {
        exportSucceeded = await downloadICS(flightsToExport.map((flight) => ({...flight})), {updatedFlightIds});
        setCopyFeedback(null);
      } else {
        const copied = await copyFlightsToClipboard(flightsToExport.map((flight) => ({...flight})), {updatedFlightIds});
        exportSucceeded = copied;
        setCopyFeedback(copied ? t.copiedEventText : t.clipboardCopyFailed);
      }

      if (!exportSucceeded) {
        setShowCalendarMenu(false);
        return;
      }

      const exportedAt = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        flights: prev.flights.map((flight) => (
          flightsToExport.some((exportFlight) => exportFlight.id === flight.id)
            ? {
                ...flight,
                calendarExportedAt: exportedAt,
                calendarExportFingerprint: getCalendarExportFingerprint(flight),
              }
            : flight
        )),
      }));
    } catch (error) {
      console.error(type === 'ics' ? 'ICS export failed' : 'Clipboard copy failed', error);
      setCopyFeedback(t.clipboardCopyFailed);
    }
    setShowCalendarMenu(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(event.target as Node)) {
        setShowCalendarMenu(false);
      }
      if (scanMenuRef.current && !scanMenuRef.current.contains(event.target as Node)) {
        setShowScanMenu(false);
      }
      if (shiftMenuRef.current && !shiftMenuRef.current.contains(event.target as Node)) {
        setShowShiftMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    ocrReviewRef.current = ocrReview;
  }, [ocrReview]);

  useEffect(() => () => {
    ocrReviewRef.current?.previews.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, []);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timer = window.setTimeout(() => setCopyFeedback(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const snapshot: PersistedState = {
      appState: {
        ...state,
        flights: pruneExpiredImportedFlights(state.flights),
      },
      terminalFilter,
      scanTerminal,
      connectionThreshold,
    };

    window.localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(snapshot));
  }, [state, terminalFilter, scanTerminal, connectionThreshold]);

  useEffect(() => {
    if (!isExtracting) {
      setScanLoadingIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setScanLoadingIndex((prev) => (prev + 1) % SCAN_LOADING_MESSAGES.length);
    }, 3600);

    return () => window.clearInterval(interval);
  }, [isExtracting]);

  const selectedOcrCount = ocrReview ? ocrReview.flights.filter(flight => flight.selected).length : 0;
  const hasInvalidSelectedOcrFlights = ocrReview ? ocrReview.flights.some(flight => flight.selected && !canImportOcrFlight(flight, state.flights)) : false;
  const ocrFixFlight = ocrReview && ocrFixFlightId
    ? ocrReview.flights.find((flight) => flight.id === ocrFixFlightId) ?? null
    : null;
  const visibleOcrFlights = ocrReview
    ? ocrReview.flights
      .filter((flight) => (
        ocrReviewTypeFilter === 'All' || getPositionType(flight.terminal, flight.position) === ocrReviewTypeFilter
      ))
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime())
    : [];
  const ocrMergeInfoById = useMemo(
    () => new Map((ocrReview?.flights ?? []).map((flight) => [flight.id, getOcrMergeInfo(flight, state.flights)])),
    [ocrReview, state.flights],
  );

  const togglePositionTypeFilter = (type: PositionType) => {
    setState((prev) => {
      const isSelected = prev.filterTypes.includes(type);
      const nextFilterTypes = isSelected
        ? prev.filterTypes.filter((currentType) => currentType !== type)
        : [...prev.filterTypes, type];

      return {
        ...prev,
        filterTypes: nextFilterTypes,
      };
    });
  };

  const skipOcrFixFlight = () => {
    if (!ocrFixFlightId) {
      return;
    }

    setOcrReview((prev) => {
      if (!prev) {
        return prev;
      }

      const updatedFlights = prev.flights.map((flight) =>
        flight.id === ocrFixFlightId ? { ...flight, selected: false } : flight
      );
      const nextInvalid = updatedFlights.find((flight) => flight.selected && !canImportOcrFlight(flight, state.flights));
      setOcrFixFlightId(nextInvalid ? nextInvalid.id : null);

      return {
        ...prev,
        flights: updatedFlights,
      };
    });
  };

  useEffect(() => {
    if (!ocrReview || !ocrFixFlightId) {
      return;
    }

    const currentFlight = ocrReview.flights.find((flight) => flight.id === ocrFixFlightId);
    if (!currentFlight) {
      setOcrFixFlightId(null);
      return;
    }

    if (canImportOcrFlight(currentFlight, state.flights)) {
      const nextInvalid = ocrReview.flights.find(
        (flight) => flight.selected && flight.id !== currentFlight.id && !canImportOcrFlight(flight, state.flights),
      );
      setOcrFixFlightId(nextInvalid ? nextInvalid.id : null);
    }
  }, [ocrReview, ocrFixFlightId, state.flights]);
  const latestOcrPreview = ocrReview ? ocrReview.previews[ocrReview.previews.length - 1] : null;
  const annotatedOcrText = useMemo(() => {
    if (!ocrReview) {
      return '';
    }

    const crossedOutLines = ocrReview.flights
      .filter((flight) => flight.crossedOut && flight.sourceLine)
      .map((flight) => `- ${flight.sourceLine}`);

    if (crossedOutLines.length === 0) {
      return ocrReview.text.trim();
    }

    const baseText = ocrReview.text.trim();
    const crossedOutSection = `${t.crossedOutLinesDetected}:\n${crossedOutLines.join('\n')}`;
    return [baseText, crossedOutSection].filter(Boolean).join('\n\n');
  }, [ocrReview, t.crossedOutLinesDetected]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="bg-[#0a0a0a] px-4 pt-6 pb-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Plane className="text-black" size={24} />
            </div>
            <h1 className={`font-black tracking-tighter uppercase italic ${currentView === 'settings' ? 'text-lg' : 'text-xl'}`}>
              {currentView === 'settings' ? t.settings : t.appTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {currentView === 'settings' ? (
              <button
                onClick={() => setCurrentView('board')}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/70 transition-all hover:bg-white/5 hover:text-white"
                aria-label={t.backToBoard}
              >
                <ArrowLeft size={14} />
              </button>
            ) : (
              <button
                onClick={() => {
                  setShowShiftMenu(false);
                  setCurrentView('settings');
                }}
                className="rounded-xl border border-white/10 p-2 text-white/60 transition-all hover:bg-white/5 hover:text-white"
                aria-label={t.settings}
              >
                <Settings size={18} />
              </button>
            )}
            <Clock />
          </div>
        </div>
      </header>

      {currentView === 'board' && (
        <>
          {/* Sticky Search Bar */}
          <div className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/5 px-4 py-3">
            <div className="max-w-4xl mx-auto">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-emerald-500 transition-colors" size={18} />
                <input 
                  type="text"
                  placeholder={state.language === 'it' ? 'Cerca volo, baia o destinazione...' : 'Search flight, bay or destination...'}
                  value={state.searchQuery}
                  onChange={(e) => setState(prev => ({ ...prev, searchQuery: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all"
                />
                {state.searchQuery && (
                  <button 
                    onClick={() => setState(prev => ({ ...prev, searchQuery: '' }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <main className="max-w-4xl mx-auto p-4 pb-32">
        {currentView === 'settings' ? (
          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-[#111111] p-5 shadow-2xl">
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300">{t.languageSettings}</p>
                <p className="mt-2 text-sm text-white/50">{t.languageDescription}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-2">
                <div className="flex bg-black/20 p-1 rounded-full border border-white/5">
                  {([
                    { key: 'it', label: t.italian },
                    { key: 'en', label: t.english },
                  ] as const).map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setState(prev => ({ ...prev, language: option.key }))}
                      className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-all ${
                        state.language === option.key
                          ? 'bg-blue-500 text-white'
                          : 'text-white/50 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#111111] p-5 shadow-2xl">
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">{t.debug}</p>
                <p className="mt-2 text-sm text-white/50">{t.debugDescription}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-white">{t.showDummyData}</p>
                    <p className="text-xs text-white/45">
                      {state.showMockFlights ? t.showDummy : t.hideDummy}
                    </p>
                  </div>
                  <button
                    onClick={() => setState(prev => ({ ...prev, showMockFlights: !prev.showMockFlights }))}
                    className={`min-w-24 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                      state.showMockFlights
                        ? 'bg-emerald-500 text-black'
                        : 'bg-white/10 text-white/70 hover:bg-white/15'
                    }`}
                  >
                    {state.showMockFlights ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="mt-4 border-t border-white/5 pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-white">{t.clearLocalData}</p>
                      <p className="text-xs text-white/45">{t.clearLocalDataDescription}</p>
                    </div>
                    <button
                      onClick={clearLocalData}
                      className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-200 transition-all hover:bg-rose-500/20"
                    >
                      {t.clearLocalDataAction}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            capture="environment"
            className="hidden"
          />
          {!shouldShowOnboardingEmptyState && (
            <div className="flex flex-wrap gap-2 mb-6">
              <div className="relative" ref={shiftMenuRef}>
                <AnimatePresence>
                  {showShiftMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute top-full left-0 mt-3 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl z-50"
                    >
                      <div className="mb-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{t.shift}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={shiftStart}
                          onChange={(event) => {
                            setShiftStart(event.target.value);
                            setUseShiftFilter(true);
                          }}
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                        >
                          {SHIFT_TIME_OPTIONS.map((option) => (
                            <option key={`start-${option}`} value={option}>{option}</option>
                          ))}
                        </select>
                        <select
                          value={shiftEnd}
                          onChange={(event) => {
                            setShiftEnd(event.target.value);
                            setUseShiftFilter(true);
                          }}
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                        >
                          {SHIFT_TIME_OPTIONS.map((option) => (
                            <option key={`end-${option}`} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          onClick={() => setUseShiftFilter((prev) => !prev)}
                          className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                            useShiftFilter
                              ? 'bg-white/10 text-white hover:bg-white/15'
                              : 'bg-emerald-500 text-black hover:bg-emerald-400'
                          }`}
                        >
                          {useShiftFilter ? t.clearShift : t.enableShift}
                        </button>
                        <button
                          onClick={() => setShowShiftMenu(false)}
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                        >
                          {t.done}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  onClick={() => {
                    setShowCalendarMenu(false);
                    setShowScanMenu(false);
                    setShowShiftMenu(prev => !prev);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                    useShiftFilter
                      ? 'bg-emerald-500 text-black border-emerald-500'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <ClockIcon size={14} />
                  {useShiftFilter ? `${t.shift} ${shiftStart}-${shiftEnd}` : `${t.shift} ${t.shiftDisabled}`}
                </button>
              </div>

              <button 
                onClick={togglePast}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                  state.showPast 
                    ? 'bg-white text-black border-white' 
                    : 'bg-[#111111] text-white/60 border-white/10 hover:bg-[#161616]'
                }`}
              >
                <ClockIcon size={14} />
                {state.showPast ? t.showPast : t.hidePast}
              </button>

              <button 
                onClick={() => setState(prev => ({ ...prev, showFocusOnly: !prev.showFocusOnly }))}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                  state.showFocusOnly 
                    ? 'bg-amber-500 text-black border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]' 
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${state.showFocusOnly ? 'bg-black animate-pulse' : 'bg-amber-500'}`} />
                {t.focusLabel}
              </button>

              <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
                {(ALL_POSITION_TYPES).map((type) => (
                  <button
                    key={type}
                    onClick={() => togglePositionTypeFilter(type)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                      state.filterTypes.includes(type)
                        ? 'bg-emerald-500 text-black' 
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {type === 'Scivolo' ? t.scivoli : type === 'Carosello' ? t.caroselli : t.baie}
                  </button>
                ))}
              </div>

              <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
                {(['ALL', 'T1', 'T3'] as const).map((term) => (
                  <button
                    key={term}
                    onClick={() => setTerminalFilter(term)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                      terminalFilter === term 
                        ? 'bg-blue-500 text-white' 
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {term === 'ALL' ? 'T1+T3' : term}
                  </button>
                ))}
              </div>

              <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
                {([5, 10] as const).map((threshold) => (
                  <button
                    key={threshold}
                    onClick={() => setConnectionThreshold(threshold)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                      connectionThreshold === threshold 
                        ? 'bg-indigo-500 text-white' 
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {threshold}M
                  </button>
                ))}
              </div>
            </div>
          )}

        {ocrError && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <p>{ocrError}</p>
          </div>
        )}

        {copyFeedback && (
          <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {copyFeedback}
          </div>
        )}

        {/* Flight List */}
        <div className="space-y-0">
          {shouldShowOnboardingEmptyState ? (
            <div className="py-12">
              <div className="mx-auto max-w-xl rounded-[28px] border border-white/10 bg-[#111111] px-6 py-10 text-center shadow-2xl">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/10 border border-emerald-500/20">
                  <Camera size={34} className="text-emerald-300" />
                </div>
                <p className="text-xl font-black text-white">{t.noFlightsScheduled}</p>
                <p className="mx-auto mt-3 max-w-md text-sm text-white/50">{t.emptyStateHint}</p>
                <div className="mt-6">
                  <div className="mx-auto flex max-w-sm flex-col gap-3">
                    <div className="flex w-full justify-center bg-white/5 p-1.5 rounded-full border border-white/10">
                      {(['T1', 'T3'] as const).map((term) => (
                        <button
                          key={term}
                          onClick={() => setScanTerminal(term)}
                          className={`flex-1 px-6 py-3 rounded-full text-sm font-black transition-all ${
                            scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                          }`}
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">{t.shift}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={shiftStart}
                          onChange={(event) => {
                            setShiftStart(event.target.value);
                            setUseShiftFilter(true);
                          }}
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                        >
                          {SHIFT_TIME_OPTIONS.map((option) => (
                            <option key={`empty-start-${option}`} value={option}>{option}</option>
                          ))}
                        </select>
                        <select
                          value={shiftEnd}
                          onChange={(event) => {
                            setShiftEnd(event.target.value);
                            setUseShiftFilter(true);
                          }}
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white outline-none"
                        >
                          {SHIFT_TIME_OPTIONS.map((option) => (
                            <option key={`empty-end-${option}`} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isExtracting}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                  >
                    {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                    {isExtracting ? SCAN_LOADING_MESSAGES[scanLoadingIndex] : t.cameraMode}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isExtracting}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={18} />
                    {t.importPhoto}
                  </button>
                </div>
              </div>
            </div>
          ) : shouldShowFilteredEmptyState ? (
            <div className="py-10">
              <div className="mx-auto max-w-xl rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-8 text-center">
                <p className="text-lg font-black text-white">{t.noFlightsVisible}</p>
                <p className="mx-auto mt-3 max-w-md text-sm text-white/50">{t.noFlightsVisibleHint}</p>
              </div>
            </div>
          ) : (
            filteredFlights.map((flight, index) => {
              const nextFlight = filteredFlights[index + 1];
              const prevFlight = filteredFlights[index - 1];
              
              const isConnectedToNext = nextFlight && 
                (new Date(nextFlight.std).getTime() - new Date(flight.std).getTime()) <= connectionThreshold * 60000;
              
              const isConnectedToPrev = prevFlight &&
                (new Date(flight.std).getTime() - new Date(prevFlight.std).getTime()) <= connectionThreshold * 60000;

              const minutesToSTD = Math.floor((new Date(flight.std).getTime() - Date.now()) / 60000);
              const urgencyColor = getUrgencyColor(minutesToSTD);

              // Calculate focus index (1, 2, 3...) for flights in the 15-90m window
              const focusedFlights = filteredFlights.filter(f => {
                const m = Math.floor((new Date(f.std).getTime() - Date.now()) / 60000);
                return m >= 15 && m <= 90;
              });
              const focusIndex = focusedFlights.findIndex(f => f.id === flight.id) + 1;

              let nextUrgencyColor = '';
              if (nextFlight) {
                const nextMinutesToSTD = Math.floor((new Date(nextFlight.std).getTime() - Date.now()) / 60000);
                nextUrgencyColor = getUrgencyColor(nextMinutesToSTD);
              }
              
              return (
                <FlightCard 
                  key={flight.id} 
                  flight={flight} 
                  t={t}
                  language={state.language}
                  isConnectedToNext={isConnectedToNext}
                  isConnectedToPrev={isConnectedToPrev}
                  urgencyColor={urgencyColor}
                  nextUrgencyColor={nextUrgencyColor}
                  focusIndex={focusIndex > 0 ? focusIndex : undefined}
                />
              );
            })
          )}
        </div>
        </>
        )}
      </main>

      {/* Bottom Bar */}
      {(filteredFlights.length > 0 || currentView === 'settings') && (
        <div className="fixed bottom-6 right-6 z-[100] pointer-events-none">
          <div className="flex justify-end pointer-events-auto">
            <div className="bg-[#1a1a1a]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex gap-2 shadow-2xl">
              {currentView !== 'settings' && (
                <div className="relative" ref={scanMenuRef}>
                  <AnimatePresence>
                    {showScanMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute bottom-full right-0 mb-4 w-64 bg-[#1a1a1a] border border-white/10 rounded-2xl p-2 shadow-2xl z-[110]"
                      >
                        <div className="px-3 py-2 border-b border-white/5 mb-2">
                          <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                            {t.scanTerminalLabel}
                          </p>
                        </div>
                        <div className="mb-2 flex bg-white/5 p-1 rounded-xl border border-white/10 items-center">
                          {(['T1', 'T3'] as const).map((term) => (
                            <button
                              key={term}
                              onClick={() => setScanTerminal(term)}
                              className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-bold transition-all ${
                                scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                              }`}
                              aria-label={`${t.scanTerminalLabel}: ${term}`}
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => {
                            setShowScanMenu(false);
                            cameraInputRef.current?.click();
                          }}
                          disabled={isExtracting}
                          className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left disabled:opacity-70"
                        >
                          {isExtracting ? <Loader2 size={16} className="animate-spin text-emerald-300" /> : <Camera size={16} className="text-emerald-400" />}
                          <div className="flex flex-col">
                            <span className="font-bold">{t.cameraMode}</span>
                            <span className="text-[10px] text-white/40">{scanTerminal}</span>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            setShowScanMenu(false);
                            fileInputRef.current?.click();
                          }}
                          disabled={isExtracting}
                          className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left disabled:opacity-70"
                        >
                          <Plus size={16} className="text-white/60" />
                          <div className="flex flex-col">
                            <span className="font-bold">{t.importPhoto}</span>
                            <span className="text-[10px] text-white/40">{scanTerminal}</span>
                          </div>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={() => {
                      setShowShiftMenu(false);
                      setShowCalendarMenu(false);
                      setShowScanMenu(prev => !prev);
                    }}
                    disabled={isExtracting}
                    className={`p-3 rounded-xl transition-all ${
                      showScanMenu || isExtracting
                        ? 'bg-white/10 text-white'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    } disabled:opacity-70`}
                    aria-label={t.cameraMode}
                  >
                    {isExtracting ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
                  </button>
                </div>
              )}
              <div className="relative" ref={calendarMenuRef}>
                <AnimatePresence>
                  {showCalendarMenu && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full right-0 mb-4 w-64 bg-[#1a1a1a] border border-white/10 rounded-2xl p-2 shadow-2xl z-[110]"
                    >
                      <div className="px-3 py-2 border-b border-white/5 mb-1">
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                          {t.export} ({filteredFlights.length} {t.flights})
                        </p>
                      </div>
                      <button 
                        onClick={() => handleCalendarExport('ics')}
                        className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left"
                      >
                        <Download size={16} className="text-blue-400" />
                        <div className="flex flex-col">
                          <span className="font-bold">Apple / Outlook / ICS</span>
                          <span className="text-[10px] text-white/40">{t.downloadBulkImport}</span>
                        </div>
                      </button>
                      <div className="px-3 py-2 bg-white/[0.02] rounded-xl mt-1">
                        <p className="text-[9px] text-white/30 leading-relaxed italic">
                          {t.mobileIcsHint}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleCalendarExport('copy')}
                        className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left"
                      >
                        <Copy size={16} className="text-emerald-400" />
                        <div className="flex flex-col">
                          <span className="font-bold">{t.copyForAi}</span>
                          <span className="text-[10px] text-white/40">
                            {t.copyEventText}
                          </span>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button 
                  onClick={() => {
                    setShowShiftMenu(false);
                    setShowScanMenu(false);
                    setShowCalendarMenu(!showCalendarMenu);
                  }}
                  className={`p-3 rounded-xl transition-all ${showCalendarMenu ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                >
                  <CalendarIcon size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {ocrReview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-4"
          >
            <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.98 }}
                className="flex h-[92vh] w-full max-w-7xl flex-col gap-4 overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] p-4 shadow-2xl"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                  <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">{t.ocrReview}</p>
                      <p className="text-sm text-white/60">
                        {ocrReview.previews.length} {t.imagesScanned}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isExtracting}
                        className="rounded-xl border border-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500/10 disabled:opacity-60"
                      >
                        <span className="inline-flex items-center gap-2">
                          {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                          {t.cameraMode}
                        </span>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isExtracting}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white disabled:opacity-60"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Plus size={14} />
                          {t.importPhoto}
                        </span>
                      </button>
                      <button
                        onClick={closeOcrReview}
                        className="rounded-xl p-2 text-white/40 transition-all hover:bg-white/5 hover:text-white"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="px-4 pt-4 lg:hidden">
                    <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                      <button
                        onClick={() => setMobileOcrPanel('flights')}
                        className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                          mobileOcrPanel === 'flights' ? 'bg-blue-500 text-white' : 'text-white/50 hover:text-white'
                        }`}
                      >
                        {t.ocrFlightsTab}
                      </button>
                      <button
                        onClick={() => setMobileOcrPanel('photo')}
                        className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                          mobileOcrPanel === 'photo' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'
                        }`}
                      >
                        {t.ocrPhotoTab}
                      </button>
                    </div>
                  </div>
                  <div className="hidden min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid lg:grid-cols-[minmax(280px,0.68fr)_minmax(0,1.32fr)]">
                    <div className="space-y-3">
                      {latestOcrPreview && (
                        <img
                          src={latestOcrPreview.previewUrl}
                          alt={t.uploadedFlightSheet}
                          className="w-full rounded-2xl border border-white/10 object-cover"
                        />
                      )}
                      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">{t.latestImage}</div>
                          <div className="text-xs text-white/40 truncate">
                            {latestOcrPreview?.fileName}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ocrReview.previews.map((preview, index) => (
                            <div key={`${preview.fileName}-${index}`} className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold text-white/60">
                              {preview.fileName}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">
                          <ScanText size={14} />
                          {t.rawOcrText}
                        </div>
                        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
                          {annotatedOcrText || t.noOcrTextRecognized}
                        </pre>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03]">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="p-4 pb-0">
                          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300">{t.parsedFlights}</p>
                          <p className="mt-1 text-sm text-white/50">{t.parsedFlightsHint}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 p-4 pb-0">
                          <button
                            onClick={() => setOcrSelectionByType('Scivolo')}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrSelectionPreset === 'Scivolo'
                                ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                                : 'border-amber-500/20 text-amber-200 hover:bg-amber-500/10'
                            }`}
                          >
                            {t.onlyScivoli}
                          </button>
                          <button
                            onClick={() => setOcrSelectionByType('Carosello')}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrSelectionPreset === 'Carosello'
                                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                                : 'border-cyan-500/20 text-cyan-200 hover:bg-cyan-500/10'
                            }`}
                          >
                            {t.onlyCaroselli}
                          </button>
                          <button
                            onClick={() => setOcrSelectionByType('Baia')}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrSelectionPreset === 'Baia'
                                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                                : 'border-emerald-500/20 text-emerald-200 hover:bg-emerald-500/10'
                            }`}
                          >
                            {t.onlyBaie}
                          </button>
                          <button
                            onClick={() => {
                              setOcrReviewTypeFilter('All');
                              toggleAllOcrCandidates(true);
                            }}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrSelectionPreset === 'All'
                                ? 'border-white/20 bg-white/10 text-white'
                                : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {t.all}
                          </button>
                          <button
                            onClick={() => toggleAllOcrCandidates(false)}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrSelectionPreset === 'None'
                                ? 'border-white/20 bg-white/10 text-white'
                                : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {t.none}
                          </button>
                          <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70">
                            {selectedOcrCount}/{ocrReview.flights.length}
                          </div>
                        </div>
                      </div>

                      {ocrReview.flights.length === 0 ? (
                        <div className="mx-4 mb-4 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/40">
                          {t.noCompleteFlightsParsed}
                        </div>
                      ) : visibleOcrFlights.length === 0 ? (
                        <div className="mx-4 mb-4 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/40">
                          {t.noFlightsMatchTypeFilter}
                        </div>
                      ) : (
                        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                          <div className="space-y-3">
                          {visibleOcrFlights.map((flight: OCRReviewFlight) => (
                            <OCRPreviewCard
                              key={flight.id}
                              flight={flight}
                              onToggle={toggleOcrCandidate}
                              onFieldChange={updateOcrCandidateField}
                              t={t}
                              language={state.language}
                              mergeInfo={ocrMergeInfoById.get(flight.id) ?? { status: 'new', changedFields: new Set(), previousFlight: null }}
                              canImport={canImportOcrFlight(flight, state.flights)}
                            />
                          ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden p-4 lg:hidden">
                    {mobileOcrPanel === 'flights' ? (
                      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03]">
                        <div className="border-b border-white/5 p-4 pb-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300">{t.parsedFlights}</p>
                            <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70">
                              {selectedOcrCount}/{ocrReview.flights.length}
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            <button
                              onClick={() => setOcrSelectionByType('Scivolo')}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrSelectionPreset === 'Scivolo'
                                  ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                                  : 'border-amber-500/20 text-amber-200 hover:bg-amber-500/10'
                              }`}
                            >
                              {t.onlyScivoli}
                            </button>
                            <button
                              onClick={() => setOcrSelectionByType('Carosello')}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrSelectionPreset === 'Carosello'
                                  ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                                  : 'border-cyan-500/20 text-cyan-200 hover:bg-cyan-500/10'
                              }`}
                            >
                              {t.onlyCaroselli}
                            </button>
                            <button
                              onClick={() => setOcrSelectionByType('Baia')}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrSelectionPreset === 'Baia'
                                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                                  : 'border-emerald-500/20 text-emerald-200 hover:bg-emerald-500/10'
                              }`}
                            >
                              {t.onlyBaie}
                            </button>
                            <button
                              onClick={() => {
                                setOcrReviewTypeFilter('All');
                                toggleAllOcrCandidates(true);
                              }}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrSelectionPreset === 'All'
                                  ? 'border-white/20 bg-white/10 text-white'
                                  : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              {t.all}
                            </button>
                            <button
                              onClick={() => toggleAllOcrCandidates(false)}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrSelectionPreset === 'None'
                                  ? 'border-white/20 bg-white/10 text-white'
                                  : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              {t.none}
                            </button>
                          </div>
                        </div>
                        {ocrReview.flights.length === 0 ? (
                          <div className="m-4 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/40">
                            {t.noCompleteFlightsParsed}
                          </div>
                        ) : visibleOcrFlights.length === 0 ? (
                          <div className="m-4 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/40">
                            {t.noFlightsMatchTypeFilter}
                          </div>
                        ) : (
                          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                            <div className="space-y-3">
                              {visibleOcrFlights.map((flight: OCRReviewFlight) => (
                                <OCRPreviewCard
                                  key={flight.id}
                                  flight={flight}
                                  onToggle={toggleOcrCandidate}
                                  onFieldChange={updateOcrCandidateField}
                                  t={t}
                                  language={state.language}
                                  mergeInfo={ocrMergeInfoById.get(flight.id) ?? { status: 'new', changedFields: new Set(), previousFlight: null }}
                                  canImport={canImportOcrFlight(flight, state.flights)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full overflow-auto space-y-3">
                        {latestOcrPreview && (
                          <img
                            src={latestOcrPreview.previewUrl}
                            alt={t.uploadedFlightSheet}
                            className="w-full rounded-2xl border border-white/10 object-cover"
                          />
                        )}
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">{t.latestImage}</div>
                            <div className="text-xs text-white/40 truncate">
                              {latestOcrPreview?.fileName}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {ocrReview.previews.map((preview, index) => (
                              <div key={`${preview.fileName}-${index}`} className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold text-white/60">
                                {preview.fileName}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">
                            <ScanText size={14} />
                            {t.rawOcrText}
                          </div>
                          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
                            {annotatedOcrText || t.noOcrTextRecognized}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-black/30 p-3">
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>{t.selected}</span>
                    <span className="font-black text-white">{selectedOcrCount}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={closeOcrReview}
                      className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                    >
                      {t.cancel}
                    </button>
                    <button
                      onClick={handleImportFlights}
                      disabled={selectedOcrCount === 0}
                      className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Plus size={14} />
                        {t.add}
                      </span>
                    </button>
                  </div>
                  {hasInvalidSelectedOcrFlights && !ocrFixFlight && (
                    <p className="mt-2 text-[11px] text-amber-200/80">{t.completeRequiredFieldsHint}</p>
                  )}
                </div>
                {ocrFixFlight && (
                  <OCRFixModal
                    flight={ocrFixFlight}
                    onFieldChange={updateOcrCandidateField}
                    onSkip={skipOcrFixFlight}
                    onAdd={handleImportFlights}
                    t={t}
                  />
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
