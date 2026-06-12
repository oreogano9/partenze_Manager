import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ArrivalFirstBaggageSample, Flight, OCRFlightCandidate, OCRSourceType, PositionType, TerminalType } from './types';
import { GLOSSARY_ENTRIES, TRANSLATIONS, getPositionType } from './constants';
import { Clock } from './components/Clock';
import { FlightCard, FlightCardExpandedContent } from './components/FlightCard';
import { formatDuration, formatHHmm, getMinutesToTarget, getUrgencyColor } from './utils/timeUtils';
import { copyFlightsToClipboard, downloadICS, getCalendarExportFingerprint } from './utils/calendarUtils';
import { extractFlightsFromImage } from './services/ocrService';
import { getCommonIataLocationName, getIataLocationName, getIataSearchIndex } from './utils/iataLookup';
import { Calendar as CalendarIcon, Plane, Search, X, Download, Copy, Camera, Loader2, ScanText, TriangleAlert, Plus, Clock as ClockIcon, ChevronDown, ChevronUp, Settings, ArrowLeft, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type OCRReviewFlight = OCRFlightCandidate & { selected: boolean };
type OCRReviewPreview = { previewUrl: string; fileName: string };
type OCRReviewState = { flights: OCRReviewFlight[]; text: string; previews: OCRReviewPreview[] };
type OCRImportStatus = 'queued' | 'processing' | 'done' | 'failed';
type OCRImportProgressItem = {
  id: string;
  fileName: string;
  status: OCRImportStatus;
  progress: number;
  message?: string;
};
type ScanTerminalMode = 'AUTO' | TerminalType;
type MergeStatus = 'new' | 'update' | 'unchanged';
type MergeField = 'flightNumber' | 'destination' | 'std' | 'position';
type OCRMergeInfo = {
  status: MergeStatus;
  changedFields: Set<MergeField>;
  previousFlight: Flight | null;
};
type MainView = 'board' | 'arrivals' | 'arrivalSheet' | 'settings';
type ArrivalTimeField = 'arrivalReceivedAt' | 'firstBaggageAt' | 'secondEntryAt' | 'thirdEntryAt' | 'endAt';
type ArrivalCounterField = 'carts' | 'akh' | 'ake' | 'transitBags';
type ArrivalCompanyOption = {
  id: string;
  label: string;
  prefixes: string[];
};
const ALL_POSITION_TYPES: PositionType[] = ['Scivolo', 'Carosello', 'Baia'];
const ARRIVAL_COMPANY_GROUPS: ArrivalCompanyOption[] = [
  { id: 'wizz', label: 'Wizz', prefixes: ['W4', 'W6'] },
];
const SCAN_TERMINAL_OPTIONS: ScanTerminalMode[] = ['AUTO', 'T1', 'T3'];
const T1_ONLY_AUTO_TERMINAL_POSITIONS = new Set([
  1, 2, 3, 4, 5, 7, 9, 11,
  39, 41, 43, 44, 45, 46, 47, 48,
]);
const T3_ONLY_AUTO_TERMINAL_POSITIONS = new Set([
  12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 34, 36, 38,
]);
type SharedBoardFilters = {
  terminalFilter: 'ALL' | 'T1' | 'T3';
  filterTypes: PositionType[];
  showFocusOnly: boolean;
  showPast: boolean;
  searchQuery: string;
  arrivalCompanyFilterIds: string[];
  useShiftFilter: boolean;
  shiftStart: string;
  shiftEnd: string;
};
type PersistedState = {
  appState: AppState;
  terminalFilter: 'ALL' | 'T1' | 'T3';
  scanTerminal: ScanTerminalMode;
  scanTerminalFallback: TerminalType;
  shiftStart: string;
  shiftEnd: string;
  useShiftFilter: boolean;
  connectionThreshold: 5 | 10;
  arrivalCompanyFilterIds: string[];
};

type SharedFlightsResponse = {
  flights?: Flight[];
  filters?: Partial<SharedBoardFilters>;
  arrivalStats?: ArrivalFirstBaggageSample[];
  savedAt?: string;
  count?: number;
  error?: string;
};

type AdrSyncResponse = {
  flights?: Flight[];
  updatedCount?: number;
  checkedCount?: number;
  provider?: string;
  fallbackUsed?: boolean;
  error?: string;
};

type AdrSyncStatus = {
  state: 'success' | 'failure';
  at: number;
  provider?: string;
  fallbackUsed?: boolean;
  message?: string;
};

type CalendarExportKind = 'all' | PositionType;

type SharedBoardStatus = {
  state: 'idle' | 'loaded' | 'saved' | 'load-failed' | 'save-failed';
  at: number;
  message?: string;
  count?: number;
  savedAt?: string;
};

type ArrivalPrediction = {
  predictedAt: string;
  delayMinutes: number;
  sampleCount: number;
  strongSampleCount: number;
};

type OCRPreviewCardProps = {
  flight: OCRReviewFlight;
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

type WatchStep = 'timeline' | 'search' | 'iataLetters' | 'iataCodes' | 'flightPrefixes' | 'flightList' | 'baiaGrid' | 'baiaFlights' | 'destinations' | 'flights' | 'detail';
type WatchDetailReturn = 'timeline' | 'flights';

const normalizeFlightCode = (value: string) => {
  const compact = value.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const match =
    compact.match(/^([A-Z]\d[A-Z]?)(\d{1,5}[A-Z]?)$/) ||
    compact.match(/^(\d[A-Z]{1,2})(\d{1,5}[A-Z]?)$/) ||
    compact.match(/^([A-Z]{1,3})(\d{1,5}[A-Z]?)$/);
  if (!match) {
    const salvageMatch = compact.match(/^([A-Z0-9]{2,3})([A-Z0-9]{1,5})$/);
    if (salvageMatch) {
      const repairedSuffix = salvageMatch[2]
        .replace(/[OQ]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5');
      if (/^\d{1,5}[A-Z]?$/.test(repairedSuffix)) {
        return `${salvageMatch[1]} ${repairedSuffix}`;
      }
    }

    return value.toUpperCase().trim().replace(/\s+/g, ' ');
  }
  return `${match[1]} ${match[2]}`;
};

const getScanTerminalLabel = (mode: ScanTerminalMode, t: any) =>
  mode === 'AUTO' ? t.autoDetect : mode;

const inferTerminalFromNonOverlappingPosition = (position: string): TerminalType | null => {
  const normalized = position.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const positionNumber = Number(normalized);
  if (T1_ONLY_AUTO_TERMINAL_POSITIONS.has(positionNumber)) {
    return 'T1';
  }

  if (T3_ONLY_AUTO_TERMINAL_POSITIONS.has(positionNumber)) {
    return 'T3';
  }

  return null;
};

const getFlightCodeKey = (flightNumber: string) => normalizeFlightCode(flightNumber).replace(/\s+/g, '');
const getFlightCarrierPrefix = (flightNumber: string) => normalizeFlightCode(flightNumber).split(/\s+/)[0] || '';
const isArrivalFlight = (flight: Pick<Flight, 'sourceType' | 'tags'>) =>
  flight.sourceType === 'arrival_screen' || flight.tags.includes('Arrivo');
const getArrivalCompanyOptionForPrefix = (prefix: string): ArrivalCompanyOption => {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const groupedCompany = ARRIVAL_COMPANY_GROUPS.find((company) => company.prefixes.includes(normalizedPrefix));
  return groupedCompany ?? {
    id: normalizedPrefix.toLowerCase(),
    label: normalizedPrefix,
    prefixes: [normalizedPrefix],
  };
};
const getArrivalCompanyOptionForFlight = (flight: Pick<Flight, 'flightNumber'>) =>
  getArrivalCompanyOptionForPrefix(getFlightCarrierPrefix(flight.flightNumber));
const getArrivalCompanyIdForFlight = (flight: Pick<Flight, 'flightNumber'>) =>
  getArrivalCompanyOptionForFlight(flight).id;
const normalizeArrivalCompanyFilterIds = (ids?: string[]) => (
  Array.isArray(ids)
    ? Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : ['wizz']
);
const getArrivalStatsSampleId = (flight: Pick<Flight, 'std' | 'flightNumber' | 'destination'>) => {
  const date = new Date(flight.std);
  const dateKey = Number.isNaN(date.getTime()) ? flight.std.slice(0, 10) : date.toLocaleDateString('sv-SE');
  return `${normalizeFlightCode(flight.flightNumber)}|${flight.destination.trim().toUpperCase()}|${dateKey}`;
};
const getArrivalFirstBaggageDelayMinutes = (flight: Pick<Flight, 'std' | 'firstBaggageAt'>) => {
  if (!flight.firstBaggageAt) {
    return null;
  }

  const scheduledAt = new Date(flight.std);
  const firstBaggageAt = new Date(flight.firstBaggageAt);
  if (Number.isNaN(scheduledAt.getTime()) || Number.isNaN(firstBaggageAt.getTime())) {
    return null;
  }

  const delay = Math.round((firstBaggageAt.getTime() - scheduledAt.getTime()) / 60000);
  return delay >= 0 && delay <= 180 ? delay : null;
};
const createArrivalFirstBaggageSample = (flight: Flight, firstBaggageAt: string): ArrivalFirstBaggageSample | null => {
  const delayMinutes = getArrivalFirstBaggageDelayMinutes({ ...flight, firstBaggageAt });
  if (delayMinutes === null) {
    return null;
  }

  return {
    id: getArrivalStatsSampleId(flight),
    sourceFlightId: flight.id,
    flightNumber: normalizeFlightCode(flight.flightNumber),
    carrierPrefix: getFlightCarrierPrefix(flight.flightNumber),
    destination: flight.destination.trim().toUpperCase(),
    terminal: flight.terminal,
    position: flight.position,
    scheduledAt: flight.std,
    firstBaggageAt,
    delayMinutes,
    recordedAt: new Date().toISOString(),
  };
};
const normalizeArrivalStats = (samples?: ArrivalFirstBaggageSample[]) => (
  Array.isArray(samples)
    ? samples
      .filter((sample) => (
        typeof sample.id === 'string' &&
        typeof sample.firstBaggageAt === 'string' &&
        Number.isFinite(sample.delayMinutes) &&
        sample.delayMinutes >= 0 &&
        sample.delayMinutes <= 180
      ))
      .slice(-500)
    : []
);
const updateArrivalStatsWithFlight = (samples: ArrivalFirstBaggageSample[], flight: Flight, firstBaggageAt?: string) => {
  const sampleId = getArrivalStatsSampleId(flight);
  const withoutCurrent = samples.filter((sample) => sample.id !== sampleId);
  if (!firstBaggageAt) {
    return withoutCurrent;
  }

  const sample = createArrivalFirstBaggageSample(flight, firstBaggageAt);
  return sample ? normalizeArrivalStats([...withoutCurrent, sample]) : withoutCurrent;
};
const getArrivalPrediction = (flight: Flight, samples: ArrivalFirstBaggageSample[]): ArrivalPrediction | null => {
  const usableSamples = normalizeArrivalStats(samples);
  if (usableSamples.length === 0) {
    return null;
  }

  const carrierPrefix = getFlightCarrierPrefix(flight.flightNumber);
  const destination = flight.destination.trim().toUpperCase();
  let weightedMinutes = 0;
  let totalWeight = 0;
  let strongSampleCount = 0;

  usableSamples.forEach((sample) => {
    const sameCarrier = sample.carrierPrefix === carrierPrefix;
    const sameDestination = sample.destination === destination;
    const sameTerminal = sample.terminal === flight.terminal;
    const ageDays = Math.max(0, (Date.now() - new Date(sample.recordedAt || sample.firstBaggageAt).getTime()) / 86400000);
    const recencyWeight = Number.isFinite(ageDays) ? Math.max(0.45, 1 - ageDays / 180) : 0.75;
    const matchWeight = 0.35 +
      (sameCarrier ? 1.6 : 0) +
      (sameDestination ? 1.6 : 0) +
      (sameCarrier && sameDestination ? 2.2 : 0) +
      (sameTerminal ? 0.25 : 0);
    const weight = matchWeight * recencyWeight;

    if (sameCarrier || sameDestination) {
      strongSampleCount += 1;
    }

    weightedMinutes += sample.delayMinutes * weight;
    totalWeight += weight;
  });

  if (totalWeight <= 0) {
    return null;
  }

  const delayMinutes = Math.round(weightedMinutes / totalWeight);
  const predictedAt = updateStdTime(flight.std, formatHHmm(new Date(new Date(flight.std).getTime() + delayMinutes * 60000).toISOString()));

  return {
    predictedAt,
    delayMinutes,
    sampleCount: usableSamples.length,
    strongSampleCount,
  };
};
const hasLiveDelay = (flight: Pick<Flight, 'liveDelayMinutes' | 'liveStatus'>) =>
  Boolean(
    typeof flight.liveDelayMinutes === 'number' && flight.liveDelayMinutes !== 0 ||
    flight.liveStatus && /delay|cancel|divert/i.test(flight.liveStatus)
  );
const getLiveDelayLabel = (flight: Pick<Flight, 'liveDelayMinutes' | 'liveStatus' | 'liveRevisedAt' | 'std'>) => {
  const status = flight.liveStatus?.trim();
  const revisedTime = flight.liveRevisedAt ? formatHHmm(flight.liveRevisedAt) : formatHHmm(flight.std);

  if (typeof flight.liveDelayMinutes === 'number' && flight.liveDelayMinutes !== 0) {
    const prefix = flight.liveDelayMinutes > 0 ? 'RIT' : 'ANT';
    const sign = flight.liveDelayMinutes > 0 ? '+' : '';
    return `${prefix} ${sign}${flight.liveDelayMinutes}m · ${revisedTime}`;
  }

  return status || '';
};

const isValidOcrStd = (std: string) => !Number.isNaN(new Date(std).getTime());
const normalizeOcrPosition = (position: string) => position.trim().toUpperCase() || '/';
const isOcrFlightComplete = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position'>) =>
  Boolean(
    getFlightCodeKey(flight.flightNumber) &&
    flight.destination.trim() &&
    (flight.terminal === 'T1' || flight.terminal === 'T3') &&
    isValidOcrStd(flight.std)
  );

const getFirstMissingOcrField = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal' | 'position'>): OcrRequiredField | null => {
  if (!getFlightCodeKey(flight.flightNumber)) return 'flightNumber';
  if (!flight.destination.trim()) return 'destination';
  if (!isValidOcrStd(flight.std)) return 'std';
  if (!(flight.terminal === 'T1' || flight.terminal === 'T3')) return 'terminal';
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
  doneAt: base.doneAt || incoming.doneAt,
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
  arrivalReceivedAt: base.arrivalReceivedAt || incoming.arrivalReceivedAt,
  firstBaggageAt: base.firstBaggageAt || incoming.firstBaggageAt,
  liveScheduledAt: base.liveScheduledAt || incoming.liveScheduledAt,
  liveRevisedAt: base.liveRevisedAt || incoming.liveRevisedAt,
  liveDelayMinutes: base.liveDelayMinutes ?? incoming.liveDelayMinutes,
  liveStatus: base.liveStatus || incoming.liveStatus,
  liveSource: base.liveSource || incoming.liveSource,
  liveCheckedAt: base.liveCheckedAt || incoming.liveCheckedAt,
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
const ARRIVAL_TIME_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const ARRIVAL_TIME_MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));

const roundToNearestHalfHour = (date: Date) => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const snappedMinutes = minutes <= 15 ? 0 : minutes <= 45 ? 30 : 60;
  rounded.setMinutes(snappedMinutes, 0, 0);
  return rounded;
};

const formatTimeOption = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const formatCurrentTimeOption = () => formatTimeOption(new Date());

const PERSISTED_STATE_KEY = 'partenze-manager-state';
const LOCAL_BOARD_BACKUP_KEY = 'partenze-manager-board-backup';
const IMPORTED_FLIGHT_TTL_MS = 16 * 60 * 60 * 1000;
const SHARED_FLIGHTS_ENDPOINT = '/api/flights';
const ADR_SYNC_ENDPOINT = '/api/adr-sync';
const ADR_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const ADR_LIVE_SYNC_ENABLED = true;
const WATCH_SHARED_REFRESH_MS = 20 * 1000;
const STATUS_TICK_MS = 60 * 1000;
const DEFAULT_APP_STATE: AppState = {
  flights: [],
  language: 'it',
  showPast: false,
  filterTypes: ALL_POSITION_TYPES,
  searchQuery: '',
  showFocusOnly: false,
};
const DEFAULT_SHARED_BOARD_FILTERS: SharedBoardFilters = {
  terminalFilter: 'ALL',
  filterTypes: ALL_POSITION_TYPES,
  showFocusOnly: false,
  showPast: true,
  searchQuery: '',
  arrivalCompanyFilterIds: ['wizz'],
  useShiftFilter: false,
  shiftStart: '00:00',
  shiftEnd: '23:30',
};

const resolveShiftWindow = (start: string, end: string, now = new Date()) => {
  const [startHours, startMinutes] = start.split(':').map(Number);
  const [endHours, endMinutes] = end.split(':').map(Number);
  const shiftStart = new Date(now);
  shiftStart.setHours(startHours, startMinutes, 0, 0);
  const shiftEnd = new Date(now);
  shiftEnd.setHours(endHours, endMinutes, 0, 0);

  if (shiftEnd.getTime() <= shiftStart.getTime()) {
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }

  if (now.getTime() < shiftStart.getTime() && shiftEnd.getDate() !== shiftStart.getDate()) {
    shiftStart.setDate(shiftStart.getDate() - 1);
    shiftEnd.setDate(shiftEnd.getDate() - 1);
  }

  return { shiftStart, shiftEnd };
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

const normalizeStoredFlights = (flights: Flight[]) =>
  pruneExpiredImportedFlights(flights).map((flight) => ({
    ...flight,
    flightNumber: normalizeFlightCode(flight.flightNumber),
    tags: Array.isArray(flight.tags) ? flight.tags : [],
  }));

const normalizeSharedBoardFilters = (filters?: Partial<SharedBoardFilters>): SharedBoardFilters => ({
  terminalFilter: filters?.terminalFilter === 'T1' || filters?.terminalFilter === 'T3' ? filters.terminalFilter : 'ALL',
  filterTypes: Array.isArray(filters?.filterTypes)
    ? filters.filterTypes.filter((type): type is PositionType => ALL_POSITION_TYPES.includes(type as PositionType))
    : ALL_POSITION_TYPES,
  showFocusOnly: filters?.showFocusOnly === true,
  showPast: filters?.showPast !== false,
  searchQuery: typeof filters?.searchQuery === 'string' ? filters.searchQuery : '',
  arrivalCompanyFilterIds: normalizeArrivalCompanyFilterIds(filters?.arrivalCompanyFilterIds),
  useShiftFilter: filters?.useShiftFilter === true,
  shiftStart: typeof filters?.shiftStart === 'string' && /^\d{2}:\d{2}$/.test(filters.shiftStart)
    ? filters.shiftStart
    : DEFAULT_SHARED_BOARD_FILTERS.shiftStart,
  shiftEnd: typeof filters?.shiftEnd === 'string' && /^\d{2}:\d{2}$/.test(filters.shiftEnd)
    ? filters.shiftEnd
    : DEFAULT_SHARED_BOARD_FILTERS.shiftEnd,
});

const getSharedBoardFiltersSnapshot = (
  state: AppState,
  terminalFilter: 'ALL' | 'T1' | 'T3',
  useShiftFilter: boolean,
  shiftStart: string,
  shiftEnd: string,
  arrivalCompanyFilterIds: string[],
): SharedBoardFilters => ({
  terminalFilter,
  filterTypes: state.filterTypes,
  showFocusOnly: state.showFocusOnly,
  showPast: state.showPast,
  searchQuery: state.searchQuery,
  arrivalCompanyFilterIds: normalizeArrivalCompanyFilterIds(arrivalCompanyFilterIds),
  useShiftFilter,
  shiftStart,
  shiftEnd,
});

const formatMinutesAgo = (timestamp: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  return `${minutes}m ago`;
};

const getStatusMessageSuffix = (message?: string) => {
  const cleanMessage = message?.trim();
  return cleanMessage ? `: ${cleanMessage}` : '';
};

const shouldUseWatchView = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const pathname = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);
  const userAgent = window.navigator.userAgent;
  const smallestViewportSide = Math.min(window.innerWidth, window.innerHeight);
  const largestViewportSide = Math.max(window.innerWidth, window.innerHeight);
  const hasWatchSizedViewport = smallestViewportSide <= 260 && largestViewportSide <= 360;

  return (
    pathname.startsWith('/watch') ||
    hash === '#watch' ||
    hash.startsWith('#/watch') ||
    searchParams.get('view') === 'watch' ||
    searchParams.get('watch') === '1' ||
    hasWatchSizedViewport ||
    /apple watch|watch os|watchos/i.test(userAgent)
  );
};

const loadPersistedState = (): PersistedState => {
  const defaultShiftStart = formatTimeOption(roundToNearestHalfHour(new Date()));
  const defaultShiftEndDate = new Date();
  defaultShiftEndDate.setTime(roundToNearestHalfHour(new Date()).getTime() + 8 * 60 * 60000);
  const defaultShiftEnd = formatTimeOption(defaultShiftEndDate);
  const fallback: PersistedState = {
    appState: DEFAULT_APP_STATE,
    terminalFilter: 'ALL',
    scanTerminal: 'AUTO',
    scanTerminalFallback: 'T1',
    shiftStart: defaultShiftStart,
    shiftEnd: defaultShiftEnd,
    useShiftFilter: true,
    connectionThreshold: 10,
    arrivalCompanyFilterIds: ['wizz'],
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
        flights: Array.isArray(parsed.appState?.flights)
          ? normalizeStoredFlights(parsed.appState.flights)
          : [],
        filterTypes: persistedFilterTypes,
      },
      terminalFilter: parsed.terminalFilter === 'T1' || parsed.terminalFilter === 'T3' ? parsed.terminalFilter : 'ALL',
      scanTerminal: parsed.scanTerminal === 'AUTO' || parsed.scanTerminal === 'T1' || parsed.scanTerminal === 'T3'
        ? parsed.scanTerminal
        : 'AUTO',
      scanTerminalFallback: parsed.scanTerminalFallback === 'T3' || parsed.scanTerminal === 'T3' ? 'T3' : 'T1',
      shiftStart: typeof parsed.shiftStart === 'string' && /^\d{2}:\d{2}$/.test(parsed.shiftStart)
        ? parsed.shiftStart
        : defaultShiftStart,
      shiftEnd: typeof parsed.shiftEnd === 'string' && /^\d{2}:\d{2}$/.test(parsed.shiftEnd)
        ? parsed.shiftEnd
        : defaultShiftEnd,
      useShiftFilter: typeof parsed.useShiftFilter === 'boolean' ? parsed.useShiftFilter : true,
      connectionThreshold: parsed.connectionThreshold === 5 ? 5 : 10,
      arrivalCompanyFilterIds: normalizeArrivalCompanyFilterIds(parsed.arrivalCompanyFilterIds),
    };
  } catch (error) {
    console.error('Failed to load persisted state', error);
    return fallback;
  }
};

const loadLocalBoardBackup = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_BOARD_BACKUP_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      flights?: Flight[];
      filters?: Partial<SharedBoardFilters>;
      arrivalStats?: ArrivalFirstBaggageSample[];
    };
    return {
      flights: Array.isArray(parsed.flights) ? normalizeStoredFlights(parsed.flights) : [],
      filters: normalizeSharedBoardFilters(parsed.filters),
      arrivalStats: normalizeArrivalStats(parsed.arrivalStats),
    };
  } catch (error) {
    console.error('Failed to load local board backup', error);
    return null;
  }
};

const OCRPreviewCard: React.FC<OCRPreviewCardProps> = ({flight, onFieldChange, t, language, mergeInfo, canImport}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showChangeDetails, setShowChangeDetails] = useState(false);
  const minutesToTarget = getMinutesToTarget(flight.std);
  const targetCountdown = formatDuration(minutesToTarget);
  const minutesToSTD = Math.floor((new Date(flight.std).getTime() - Date.now()) / 60000);
  const urgencyColor = getUrgencyColor(minutesToTarget);
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
          : 'border-emerald-500/20 bg-[#1a1a1a]'
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
          <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${labelClass}`}>
            {statusLabel}
          </div>
          <div className="text-[18px] font-black tracking-tighter font-mono leading-none" style={{ color: urgencyColor }}>
            {targetCountdown}
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

const WatchFlightCard: React.FC<{
  flight: Flight;
  compact?: boolean;
  isConnectedToNext?: boolean;
  nextUrgencyColor?: string;
  onClick: () => void;
  onDoubleTap: () => void;
}> = ({ flight, compact = false, isConnectedToNext = false, nextUrgencyColor, onClick, onDoubleTap }) => {
  const minutesToTarget = getMinutesToTarget(flight.std);
  const urgencyColor = getUrgencyColor(minutesToTarget);
  const targetLabel = formatDuration(minutesToTarget);
  const positionType = getPositionType(flight.terminal, flight.position);
  const isDimmed = Boolean(flight.doneAt) || minutesToTarget <= 0;
  const liveDelayLabel = hasLiveDelay(flight) ? getLiveDelayLabel(flight) : '';
  const tapTimeoutRef = useRef<number | null>(null);

  const handleClick = () => {
    if (tapTimeoutRef.current !== null) {
      window.clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
      onDoubleTap();
      return;
    }

    tapTimeoutRef.current = window.setTimeout(() => {
      tapTimeoutRef.current = null;
      onClick();
    }, 240);
  };

  useEffect(() => () => {
    if (tapTimeoutRef.current !== null) {
      window.clearTimeout(tapTimeoutRef.current);
    }
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`relative grid min-h-[4.9rem] w-full grid-cols-[4.3rem_1fr] gap-2.5 overflow-visible rounded-lg px-2.5 py-2.5 text-left active:scale-[0.99] ${
        flight.doneAt ? 'bg-emerald-500/10' : 'bg-white/[0.055]'
      } ${
        isDimmed ? 'opacity-50' : ''
      }`}
    >
      <div
        className="relative z-10 flex h-full min-h-16 flex-col items-center justify-center rounded-md text-white"
        style={{ backgroundColor: urgencyColor }}
      >
        <span className="text-[1.65rem] font-black leading-none">{flight.position || 'X'}</span>
        <span className="mt-1 text-[13px] font-black leading-none">{flight.terminal}</span>
      </div>
      {isConnectedToNext && (
        <div
          className="pointer-events-none absolute left-[2.8rem] top-[calc(100%-0.45rem)] z-[1] h-7 w-2 -translate-x-1/2 rounded-full opacity-80"
          style={{
            background: `linear-gradient(to bottom, ${urgencyColor}, ${nextUrgencyColor || urgencyColor})`,
          }}
        />
      )}
      <div className="min-w-0 self-center">
        <div className="flex min-w-0 items-baseline justify-between gap-1.5">
          <span className="truncate text-[1.5rem] font-black leading-none text-white">{flight.destination}</span>
          <span className="shrink-0 text-xl font-black leading-none text-emerald-200">{formatHHmm(flight.std)}</span>
        </div>
        {liveDelayLabel && (
          <div className="mt-1 inline-flex max-w-full rounded-md bg-amber-400 px-1.5 py-0.5 text-[12px] font-black leading-none text-black">
            {liveDelayLabel}
          </div>
        )}
        <div className="mt-2 flex min-w-0 items-center justify-between gap-1.5 text-sm font-bold leading-none text-white/55">
          <span className="truncate">{flight.flightNumber}</span>
          <span className="flex shrink-0 items-center gap-1 text-white/65">
            {flight.doneAt && <Check size={13} className="text-emerald-200" />}
            {targetLabel}
          </span>
        </div>
        {!compact && (
          <div className="mt-1.5 flex items-center justify-between gap-1.5 text-[13px] font-bold leading-none text-white/35">
            <span>{positionType}</span>
            {flight.tot && <span className="truncate text-emerald-200/80">{flight.tot}</span>}
          </div>
        )}
      </div>
    </button>
  );
};

const WatchArrivalCard: React.FC<{
  flight: Flight;
  expanded: boolean;
  onToggleExpanded: () => void;
}> = ({ flight, expanded, onToggleExpanded }) => {
  const timeRows: Array<[string, string | undefined]> = [
    ['Arrivo', flight.arrivalReceivedAt],
    ['Prima', flight.firstBaggageAt],
    ['2a', flight.secondEntryAt],
    ['3a', flight.thirdEntryAt],
    ['Fine', flight.endAt],
  ];

  return (
    <button
      type="button"
      onClick={onToggleExpanded}
      className="w-full rounded-lg bg-white/[0.06] px-2.5 py-2.5 text-left active:scale-[0.99]"
    >
      <div className="grid grid-cols-[4.2rem_1fr] gap-2.5">
        <div className="flex min-h-[4.6rem] flex-col items-center justify-center rounded-md bg-yellow-300 text-black">
          <span className="text-[1.85rem] font-black leading-none">{flight.position || 'X'}</span>
          <span className="mt-1 text-[11px] font-black uppercase leading-none">Nastro</span>
        </div>
        <div className="min-w-0 self-center">
          <div className="flex min-w-0 items-baseline justify-between gap-1.5">
            <span className="truncate text-[1.35rem] font-black leading-none text-white">{flight.destination}</span>
            <span className="shrink-0 text-xl font-black leading-none text-emerald-200">{formatHHmm(flight.std)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-1 text-sm font-bold leading-none text-white/55">
            <span className="truncate">{flight.flightNumber}</span>
            {flight.firstBaggageAt && <Check size={14} className="shrink-0 text-emerald-200" />}
          </div>
          {flight.arrivalReceivedAt && (
            <div className="mt-1 text-[12px] font-black leading-none text-sky-200">
              Arrivo {formatHHmm(flight.arrivalReceivedAt)}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {timeRows.map(([label, value]) => (
            <div key={label} className="rounded-md bg-black/25 px-2 py-1.5">
              <div className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">{label}</div>
              <div className="mt-0.5 text-base font-black leading-none text-white">{value ? formatHHmm(value) : '--:--'}</div>
            </div>
          ))}
          <div className="rounded-md bg-black/25 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">Carrelli</div>
            <div className="mt-0.5 text-base font-black leading-none text-white">{flight.carts ?? 0}</div>
          </div>
          <div className="rounded-md bg-black/25 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">AKH/AKE</div>
            <div className="mt-0.5 text-base font-black leading-none text-white">{flight.akh ?? 0}/{flight.ake ?? 0}</div>
          </div>
          <div className="rounded-md bg-black/25 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">Transiti</div>
            <div className="mt-0.5 text-base font-black leading-none text-white">{flight.hasTransit ? flight.transitBags ?? 0 : '-'}</div>
          </div>
          {flight.teamLeaderNote && (
            <div className="col-span-2 rounded-md bg-black/25 px-2 py-1.5">
              <div className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">Note</div>
              <div className="mt-0.5 line-clamp-3 text-sm font-bold leading-snug text-white/75">{flight.teamLeaderNote}</div>
            </div>
          )}
        </div>
      )}
    </button>
  );
};

const WatchLocationName: React.FC<{ destination: string }> = ({ destination }) => {
  const [location, setLocation] = useState(() => getCommonIataLocationName(destination, 'it'));

  useEffect(() => {
    let cancelled = false;
    const commonName = getCommonIataLocationName(destination, 'it');
    setLocation(commonName);

    if (commonName) {
      return () => {
        cancelled = true;
      };
    }

    getIataLocationName(destination, 'it').then((name) => {
      if (!cancelled) {
        setLocation(name || '');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [destination]);

  return <>{location || destination}</>;
};

const getWatchFlightPrefix = (flightNumber: string) =>
  flightNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || '--';

const getWatchPositionSortValue = (position: string) => {
  const match = position.match(/\d+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
};

const WatchApp: React.FC<{
  flights: Flight[];
  filters: SharedBoardFilters;
  connectionThreshold: 5 | 10;
  isLoading: boolean;
  sharedStatus: SharedBoardStatus;
  onToggleDone: (id: string) => void;
}> = ({ flights, filters, connectionThreshold, isLoading, sharedStatus, onToggleDone }) => {
  const [step, setStep] = useState<WatchStep>('timeline');
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [selectedIataLetter, setSelectedIataLetter] = useState<string | null>(null);
  const [selectedFlightPrefix, setSelectedFlightPrefix] = useState<string | null>(null);
  const [selectedWatchPosition, setSelectedWatchPosition] = useState<string | null>(null);
  const [expandedArrivalIds, setExpandedArrivalIds] = useState<string[]>([]);
  const [detailReturn, setDetailReturn] = useState<WatchDetailReturn>('timeline');
  const arrivalFlights = useMemo(() => (
    flights
      .filter(isArrivalFlight)
      .filter((flight) => !Number.isNaN(new Date(flight.std).getTime()))
      .filter((flight) => filters.arrivalCompanyFilterIds.includes(getArrivalCompanyIdForFlight(flight)))
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime())
  ), [flights, filters.arrivalCompanyFilterIds]);
  const shouldShowArrivals = arrivalFlights.length > 0;

  const baseVisibleFlights = useMemo(() => {
    if (shouldShowArrivals) {
      return [];
    }

    const now = Date.now();
    const query = filters.searchQuery.trim().toLowerCase();
    const { shiftStart: shiftLowerBound, shiftEnd: shiftEndDate } = resolveShiftWindow(filters.shiftStart, filters.shiftEnd, new Date(now));
    const shiftUpperBound = new Date(shiftEndDate.getTime() + 60 * 60000);

    return flights
      .filter((flight) => !Number.isNaN(new Date(flight.std).getTime()))
      .filter((flight) => !isArrivalFlight(flight))
      .filter((flight) => getMinutesToTarget(flight.std) > -10)
      .filter((flight) => {
        const flightTime = new Date(flight.std);
        const minutesToSTD = Math.floor((flightTime.getTime() - now) / 60000);
        const positionType = getPositionType(flight.terminal, flight.position);
        const matchesSearch = !query ||
          flight.flightNumber.toLowerCase().includes(query) ||
          flight.destination.toLowerCase().includes(query) ||
          flight.position.toLowerCase().includes(query);

        return (
          (filters.showPast ? flightTime.getTime() >= now - 60 * 60000 : flightTime.getTime() > now) &&
          (filters.terminalFilter === 'ALL' || flight.terminal === filters.terminalFilter) &&
          filters.filterTypes.includes(positionType) &&
          matchesSearch &&
          (!filters.showFocusOnly || (minutesToSTD >= 15 && minutesToSTD <= 90)) &&
          (!filters.useShiftFilter || (flightTime >= shiftLowerBound && flightTime <= shiftUpperBound))
        );
      })
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime());
  }, [flights, filters, shouldShowArrivals]);

  const visibleFlights = baseVisibleFlights;
  const hasHiddenFlights = !isLoading && flights.length > 0 && baseVisibleFlights.length === 0;
  const statusLabel = shouldShowArrivals
    ? `Arrivi ${arrivalFlights.length}/${flights.filter(isArrivalFlight).length}`
    : `${visibleFlights.length}/${flights.length}`;

  const destinations = useMemo(() => {
    const grouped = new Map<string, Flight[]>();
    visibleFlights.forEach((flight) => {
      const code = flight.destination.trim().toUpperCase() || '---';
      grouped.set(code, [...(grouped.get(code) ?? []), flight]);
    });

    return Array.from(grouped.entries())
      .map(([code, destinationFlights]) => ({
        code,
        flights: destinationFlights.sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime()),
      }))
      .sort((a, b) => new Date(a.flights[0].std).getTime() - new Date(b.flights[0].std).getTime());
  }, [visibleFlights]);

  const iataLetters = useMemo(() => {
    const letters = new Map<string, Flight>();
    baseVisibleFlights.forEach((flight) => {
      const code = flight.destination.trim().toUpperCase() || '---';
      const letter = code[0] || '-';
      if (!letters.has(letter)) {
        letters.set(letter, flight);
      }
    });

    return Array.from(letters.entries())
      .map(([letter, flight]) => ({
        letter,
        firstStd: flight.std,
      }))
      .sort((a, b) => new Date(a.firstStd).getTime() - new Date(b.firstStd).getTime());
  }, [baseVisibleFlights]);

  const iataCodes = useMemo(() => {
    if (!selectedIataLetter) {
      return [];
    }

    const grouped = new Map<string, Flight[]>();
    baseVisibleFlights.forEach((flight) => {
      const code = flight.destination.trim().toUpperCase() || '---';
      if (code.startsWith(selectedIataLetter)) {
        grouped.set(code, [...(grouped.get(code) ?? []), flight]);
      }
    });

    return Array.from(grouped.entries())
      .map(([code, destinationFlights]) => ({
        code,
        flights: destinationFlights.sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime()),
      }))
      .sort((a, b) => new Date(a.flights[0].std).getTime() - new Date(b.flights[0].std).getTime());
  }, [baseVisibleFlights, selectedIataLetter]);

  const flightPrefixes = useMemo(() => {
    const grouped = new Map<string, Flight>();
    baseVisibleFlights.forEach((flight) => {
      const prefix = getWatchFlightPrefix(flight.flightNumber);
      if (!grouped.has(prefix)) {
        grouped.set(prefix, flight);
      }
    });

    return Array.from(grouped.entries())
      .map(([prefix, flight]) => ({
        prefix,
        firstStd: flight.std,
      }))
      .sort((a, b) => new Date(a.firstStd).getTime() - new Date(b.firstStd).getTime());
  }, [baseVisibleFlights]);

  const flightPrefixFlights = useMemo(() => {
    if (!selectedFlightPrefix) {
      return [];
    }

    return baseVisibleFlights.filter((flight) => getWatchFlightPrefix(flight.flightNumber) === selectedFlightPrefix);
  }, [baseVisibleFlights, selectedFlightPrefix]);

  const watchPositions = useMemo(() => (
    Array.from(new Set<string>(baseVisibleFlights.map((flight) => flight.position.trim() || 'X')))
      .sort((a, b) => {
        const numericDiff = getWatchPositionSortValue(a) - getWatchPositionSortValue(b);
        return numericDiff || a.localeCompare(b);
      })
  ), [baseVisibleFlights]);

  const watchPositionFlights = useMemo(() => {
    if (!selectedWatchPosition) {
      return [];
    }

    return baseVisibleFlights.filter((flight) => (flight.position.trim() || 'X') === selectedWatchPosition);
  }, [baseVisibleFlights, selectedWatchPosition]);

  const destinationFlights = useMemo(() => {
    if (!selectedDestination) {
      return [];
    }

    return visibleFlights.filter((flight) => flight.destination.trim().toUpperCase() === selectedDestination);
  }, [selectedDestination, visibleFlights]);

  const selectedFlight = useMemo(
    () => visibleFlights.find((flight) => flight.id === selectedFlightId) ?? null,
    [selectedFlightId, visibleFlights],
  );
  const stepLabel = step === 'destinations'
    ? 'Dest'
    : step === 'search'
      ? 'Cerca'
    : step === 'iataLetters'
      ? 'IATA'
    : step === 'iataCodes'
      ? selectedIataLetter || 'IATA'
    : step === 'flightPrefixes'
      ? 'Volo'
    : step === 'flightList'
      ? selectedFlightPrefix || 'Volo'
    : step === 'baiaGrid'
      ? 'Baia'
    : step === 'baiaFlights'
      ? selectedWatchPosition || 'Baia'
    : step === 'flights'
      ? selectedDestination || 'Voli'
      : step === 'detail' && selectedFlight
        ? selectedFlight.destination
        : `${visibleFlights.length} voli`;

  const goBack = () => {
    if (step === 'detail') {
      setSelectedFlightId(null);
      setStep(detailReturn === 'flights' && selectedDestination ? 'flights' : 'timeline');
      return;
    }

    if (
      step === 'search' ||
      step === 'iataLetters' ||
      step === 'iataCodes' ||
      step === 'flightPrefixes' ||
      step === 'flightList' ||
      step === 'baiaGrid' ||
      step === 'baiaFlights'
    ) {
      setSelectedIataLetter(null);
      setSelectedFlightPrefix(null);
      setSelectedWatchPosition(null);
      setStep('timeline');
      return;
    }

    if (step === 'flights') {
      setSelectedDestination(null);
      setStep('destinations');
      return;
    }

    if (step === 'destinations') {
      setStep('timeline');
    }
  };

  const openFlight = (flight: Flight) => {
    setDetailReturn('flights');
    setSelectedFlightId(flight.id);
    setSelectedDestination(flight.destination.trim().toUpperCase());
    setStep('detail');
  };

  const openFlightFromSearch = (flight: Flight) => {
    setDetailReturn('timeline');
    setSelectedFlightId(flight.id);
    setSelectedDestination(flight.destination.trim().toUpperCase());
    setStep('detail');
  };

  const selectDestination = (destination: string) => {
    setSelectedDestination(destination);
    const matches = visibleFlights.filter((flight) => flight.destination.trim().toUpperCase() === destination);

    if (matches.length === 1) {
      openFlight(matches[0]);
      return;
    }

    setSelectedFlightId(null);
    setStep('flights');
  };

  const renderWatchFlightList = (
    flightList: Flight[],
    options?: {
      compact?: boolean;
      keyPrefix?: string;
      openFlightOverride?: (flight: Flight) => void;
    },
  ) => (
    <div className="space-y-2">
      {flightList.map((flight, index) => {
        const nextFlight = flightList[index + 1];
        const isConnectedToNext = Boolean(
          nextFlight &&
          new Date(nextFlight.std).getTime() - new Date(flight.std).getTime() <= connectionThreshold * 60000,
        );
        const nextUrgencyColor = nextFlight
          ? getUrgencyColor(getMinutesToTarget(nextFlight.std))
          : undefined;

        return (
          <WatchFlightCard
            key={`${options?.keyPrefix ?? 'watch'}-${flight.id}`}
            flight={flight}
            compact={options?.compact}
            isConnectedToNext={isConnectedToNext}
            nextUrgencyColor={nextUrgencyColor}
            onClick={() => (options?.openFlightOverride ?? openFlight)(flight)}
            onDoubleTap={() => onToggleDone(flight.id)}
          />
        );
      })}
    </div>
  );

  if (shouldShowArrivals) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex min-h-screen w-full max-w-none flex-col px-1 py-1">
          <div className="mb-1.5 rounded-md bg-white/[0.045] px-2 py-1.5 text-center text-[13px] font-black text-white/35">
            {statusLabel}
          </div>
          <header className="sticky top-0 z-10 -mx-1 bg-black/95 px-1 pb-2 pt-0.5">
            <div className="flex min-h-[3.65rem] items-center justify-center rounded-xl bg-white/[0.06] px-2 text-center text-[1.15rem] font-black uppercase text-emerald-300">
              Arrivi TL
            </div>
          </header>
          <main className="min-h-0 flex-1 space-y-2 overflow-auto pb-1.5">
            {isLoading ? (
              <div className="rounded-md bg-white/[0.055] p-4 text-center text-base font-bold text-white/50">
                Carico arrivi...
              </div>
            ) : arrivalFlights.length === 0 ? (
              <div className="rounded-md bg-white/[0.055] p-4 text-center text-base font-bold leading-snug text-white/50">
                Nessun arrivo
              </div>
            ) : (
              arrivalFlights.map((flight) => (
                <WatchArrivalCard
                  key={`watch-arrival-${flight.id}`}
                  flight={flight}
                  expanded={expandedArrivalIds.includes(flight.id)}
                  onToggleExpanded={() => setExpandedArrivalIds((prev) => (
                    prev.includes(flight.id)
                      ? prev.filter((id) => id !== flight.id)
                      : [...prev, flight.id]
                  ))}
                />
              ))
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen w-full max-w-none flex-col px-1 py-1">
        <div className="mb-1.5 rounded-md bg-white/[0.045] px-2 py-1.5 text-center text-[13px] font-black text-white/35">
          {statusLabel}
        </div>
        <header className="sticky top-0 z-10 -mx-1 bg-black/95 px-1 pb-2 pt-0.5">
          <div className="grid grid-cols-[3.65rem_minmax(0,1fr)_3.65rem] items-center gap-1.5">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 'timeline'}
              className="flex h-[3.65rem] w-[3.65rem] items-center justify-center rounded-xl bg-white/[0.09] text-white/85 disabled:opacity-15"
              aria-label="Back"
            >
              <ArrowLeft size={25} />
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedDestination(null);
                setSelectedFlightId(null);
                setSelectedIataLetter(null);
                setSelectedFlightPrefix(null);
                setSelectedWatchPosition(null);
                setStep('timeline');
              }}
              className="min-w-0 truncate text-center text-[1.15rem] font-black uppercase text-emerald-300"
            >
              {stepLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedDestination(null);
                setSelectedFlightId(null);
                setSelectedIataLetter(null);
                setSelectedFlightPrefix(null);
                setSelectedWatchPosition(null);
                setStep('search');
              }}
              className="flex h-[3.65rem] w-[3.65rem] items-center justify-center rounded-xl bg-white/[0.09] text-white/85"
              aria-label="Search"
            >
              <Search size={25} />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto pb-1.5">
          {isLoading ? (
            <div className="rounded-md bg-white/[0.055] p-4 text-center text-base font-bold text-white/50">
              Carico voli...
            </div>
          ) : visibleFlights.length === 0 ? (
            <div className="rounded-md bg-white/[0.055] p-4 text-center text-base font-bold leading-snug text-white/50">
              {hasHiddenFlights ? `${flights.length} filtrati` : 'Nessun volo'}
            </div>
          ) : step === 'search' ? (
            <div className="space-y-2.5">
              {[
                ['IATA', 'iataLetters'],
                ['Flight', 'flightPrefixes'],
                ['BAIA', 'baiaGrid'],
              ].map(([label, nextStep]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(nextStep as WatchStep)}
                  className="flex min-h-[5.65rem] w-full items-center justify-center rounded-xl bg-white/[0.07] text-[2rem] font-black text-white active:scale-[0.99]"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : step === 'iataLetters' ? (
            <div className="grid grid-cols-3 gap-2">
              {iataLetters.map(({ letter, firstStd }) => (
                <button
                  key={letter}
                  type="button"
                  onClick={() => {
                    setSelectedIataLetter(letter);
                    setStep('iataCodes');
                  }}
                  className="min-h-[4.65rem] rounded-lg bg-white/[0.06] px-1 text-center active:scale-[0.98]"
                >
                  <div className="text-[2rem] font-black leading-none text-white">{letter}</div>
                  <div className="mt-1.5 text-[13px] font-black leading-none text-emerald-200">{formatHHmm(firstStd)}</div>
                </button>
              ))}
            </div>
          ) : step === 'iataCodes' ? (
            <div className="grid grid-cols-2 gap-2">
              {iataCodes.map(({ code, flights: codeFlights }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => openFlightFromSearch(codeFlights[0])}
                  className="min-h-[4.65rem] rounded-lg bg-white/[0.06] px-2 text-center active:scale-[0.98]"
                >
                  <div className="truncate text-[2rem] font-black leading-none text-white">{code}</div>
                  <div className="mt-1.5 text-[13px] font-black leading-none text-emerald-200">
                    {formatHHmm(codeFlights[0].std)}
                    {codeFlights.length > 1 && <span className="ml-1.5 text-white/40">{codeFlights.length}</span>}
                  </div>
                </button>
              ))}
            </div>
          ) : step === 'flightPrefixes' ? (
            <div className="grid grid-cols-3 gap-2">
              {flightPrefixes.map(({ prefix, firstStd }) => (
                <button
                  key={prefix}
                  type="button"
                  onClick={() => {
                    setSelectedFlightPrefix(prefix);
                    setStep('flightList');
                  }}
                  className="min-h-[4.65rem] rounded-lg bg-white/[0.06] px-1 text-center active:scale-[0.98]"
                >
                  <div className="text-[2rem] font-black leading-none text-white">{prefix}</div>
                  <div className="mt-1.5 text-[13px] font-black leading-none text-emerald-200">{formatHHmm(firstStd)}</div>
                </button>
              ))}
            </div>
          ) : step === 'flightList' ? (
            renderWatchFlightList(flightPrefixFlights, {
              compact: true,
              keyPrefix: 'flight-prefix',
              openFlightOverride: openFlightFromSearch,
            })
          ) : step === 'baiaGrid' ? (
            <div className="grid grid-cols-3 gap-2">
              {watchPositions.map((position) => (
                <button
                  key={position}
                  type="button"
                  onClick={() => {
                    setSelectedWatchPosition(position);
                    setStep('baiaFlights');
                  }}
                  className="min-h-[4.65rem] rounded-lg bg-white/[0.06] px-1 text-center text-[2rem] font-black text-white active:scale-[0.98]"
                >
                  {position}
                </button>
              ))}
            </div>
          ) : step === 'baiaFlights' ? (
            renderWatchFlightList(watchPositionFlights, {
              keyPrefix: 'watch-position',
              openFlightOverride: openFlightFromSearch,
            })
          ) : step === 'destinations' ? (
            <div className="space-y-2">
              {destinations.map(({ code, flights: destinationGroup }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => selectDestination(code)}
                  className="grid min-h-[4.65rem] w-full grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg bg-white/[0.055] px-3 py-2.5 text-left active:scale-[0.99]"
                >
                  <span className="truncate text-[2rem] font-black leading-none">{code}</span>
                  <span className="text-right text-[1.15rem] font-black leading-tight text-emerald-200">
                    {formatHHmm(destinationGroup[0].std)}
                    <span className="ml-1.5 text-[13px] text-white/40">{destinationGroup.length}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : step === 'flights' ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                <div className="text-[2rem] font-black leading-none">{selectedDestination}</div>
                <div className="mt-1.5 truncate text-base font-bold leading-none text-white/45">
                  {selectedDestination && <WatchLocationName destination={selectedDestination} />}
                </div>
              </div>
              {renderWatchFlightList(destinationFlights, { compact: true, keyPrefix: 'destination' })}
            </div>
          ) : step === 'detail' && selectedFlight ? (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => onToggleDone(selectedFlight.id)}
                className={`relative w-full rounded-xl p-3 text-left active:scale-[0.99] ${
                  selectedFlight.doneAt ? 'bg-emerald-500/10 ring-1 ring-emerald-300/40' : 'bg-white/[0.065]'
                }`}
                aria-label={selectedFlight.doneAt ? 'Riapri volo' : 'Chiudi volo'}
              >
                <div className="grid grid-cols-[5.5rem_1fr] gap-2.5">
                  <div className="flex min-h-[7rem] flex-col items-center justify-center rounded-lg bg-emerald-500 px-1 text-center text-black">
                    <div className="text-[3.4rem] font-black leading-none">{selectedFlight.position || 'X'}</div>
                    <div className="mt-1.5 text-base font-black leading-none">{selectedFlight.terminal}</div>
                  </div>
                  <div className="min-w-0 self-center">
                    <div className="truncate text-[2.45rem] font-black leading-none text-white">{selectedFlight.destination}</div>
                    <div className="mt-1.5 truncate text-xl font-black leading-none text-white/70">{selectedFlight.flightNumber}</div>
                    <div className="mt-2.5 text-[2.75rem] font-black leading-none text-emerald-200">{formatHHmm(selectedFlight.std)}</div>
                    {hasLiveDelay(selectedFlight) && (
                      <div className="mt-2 inline-flex rounded-lg bg-amber-400 px-2 py-1 text-lg font-black leading-none text-black">
                        {getLiveDelayLabel(selectedFlight)}
                      </div>
                    )}
                    <div className="mt-1.5 text-base font-bold leading-none text-white/50">
                      {formatDuration(getMinutesToTarget(selectedFlight.std))}
                    </div>
                  </div>
                </div>
                <div className="mt-2.5 pr-10 text-base font-bold leading-snug text-white/70">
                  <div className="truncate text-white">
                    <WatchLocationName destination={selectedFlight.destination} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1.5 text-white/45">
                    <span>{getPositionType(selectedFlight.terminal, selectedFlight.position)}</span>
                    {selectedFlight.tot && <span className="truncate text-emerald-200">{selectedFlight.tot}</span>}
                  </div>
                </div>
                {selectedFlight.doneAt && (
                  <div className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-black">
                    <Check size={23} strokeWidth={3} />
                  </div>
                )}
              </button>

              {(selectedFlight.richiesta || selectedFlight.fc) && (
                <div className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-base font-bold leading-snug text-white/70">
                  {selectedFlight.richiesta && <div className="mt-1.5 line-clamp-3 break-words">{selectedFlight.richiesta}</div>}
                  {selectedFlight.fc && <div className="mt-1.5 text-cyan-200">FC {selectedFlight.fc}</div>}
                </div>
              )}
            </div>
          ) : (
            renderWatchFlightList(visibleFlights.slice(0, 18))
          )}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  const isWatchRoute = shouldUseWatchView();
  const defaultShiftStart = formatTimeOption(roundToNearestHalfHour(new Date()));
  const defaultShiftEndDate = new Date();
  defaultShiftEndDate.setTime(roundToNearestHalfHour(new Date()).getTime() + 8 * 60 * 60000);
  const defaultShiftEnd = formatTimeOption(defaultShiftEndDate);
  const persistedState = loadPersistedState();
  const localBoardBackup = loadLocalBoardBackup();
  const initialAppState = localBoardBackup && localBoardBackup.flights.length > 0
    ? { ...persistedState.appState, flights: localBoardBackup.flights }
    : persistedState.appState;

  const [currentView, setCurrentView] = useState<MainView>('board');
  const [state, setState] = useState<AppState>(initialAppState);
  const [glossaryQuery, setGlossaryQuery] = useState('');
  const [terminalFilter, setTerminalFilter] = useState<'ALL' | 'T1' | 'T3'>(persistedState.terminalFilter);
  const [scanTerminal, setScanTerminal] = useState<ScanTerminalMode>(persistedState.scanTerminal);
  const [scanTerminalFallback, setScanTerminalFallback] = useState<TerminalType>(persistedState.scanTerminalFallback);
  const [shiftStart, setShiftStart] = useState(persistedState.shiftStart);
  const [shiftEnd, setShiftEnd] = useState(persistedState.shiftEnd);
  const [useShiftFilter, setUseShiftFilter] = useState(persistedState.useShiftFilter);
  const [connectionThreshold, setConnectionThreshold] = useState<5 | 10>(persistedState.connectionThreshold);
  const [arrivalCompanyFilterIds, setArrivalCompanyFilterIds] = useState<string[]>(
    localBoardBackup?.filters.arrivalCompanyFilterIds ?? persistedState.arrivalCompanyFilterIds,
  );
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [showShiftMenu, setShowShiftMenu] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrImportItems, setOcrImportItems] = useState<OCRImportProgressItem[]>([]);
  const [ocrReview, setOcrReview] = useState<OCRReviewState | null>(null);
  const [ocrFixFlightId, setOcrFixFlightId] = useState<string | null>(null);
  const [arrivalTimePicker, setArrivalTimePicker] = useState<{ flightId: string; field: ArrivalTimeField } | null>(null);
  const [mobileOcrPanel, setMobileOcrPanel] = useState<'flights' | 'photo'>('flights');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [scanLoadingIndex, setScanLoadingIndex] = useState(0);
  const [iataSearchIndex, setIataSearchIndex] = useState<Map<string, string>>(new Map());
  const [hasLoadedSharedFlights, setHasLoadedSharedFlights] = useState(false);
  const [canPersistSharedFlights, setCanPersistSharedFlights] = useState(false);
  const [sharedBoardFilters, setSharedBoardFilters] = useState<SharedBoardFilters>(
    localBoardBackup?.filters ?? DEFAULT_SHARED_BOARD_FILTERS,
  );
  const [arrivalStats, setArrivalStats] = useState<ArrivalFirstBaggageSample[]>(
    localBoardBackup?.arrivalStats ?? [],
  );
  const [sharedBoardStatus, setSharedBoardStatus] = useState<SharedBoardStatus>({
    state: 'idle',
    at: Date.now(),
    count: initialAppState.flights.length,
  });
  const [adrSyncStatus, setAdrSyncStatus] = useState<AdrSyncStatus | null>(null);
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const shiftMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const ocrReviewRef = useRef<OCRReviewState | null>(null);
  const adrSyncInFlightRef = useRef(false);
  const skipNextSharedPersistRef = useRef(false);
  const stateFlightsRef = useRef<Flight[]>(state.flights);

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

  useEffect(() => {
    stateFlightsRef.current = state.flights;
  }, [state.flights]);

  useEffect(() => {
    const interval = window.setInterval(() => setStatusNow(Date.now()), STATUS_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const filteredFlights = useMemo(() => {
    const now = new Date();
    const query = state.searchQuery.toLowerCase();
    
    return state.flights
      .filter((flight) => !isArrivalFlight(flight))
      .filter(f => {
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
        const { shiftStart: shiftLowerBound, shiftEnd: shiftEndDate } = resolveShiftWindow(shiftStart, shiftEnd);
        const shiftUpperBound = new Date(shiftEndDate.getTime() + 60 * 60000);
        const flightTime = new Date(f.std);
        const matchesShift = !useShiftFilter || (flightTime >= shiftLowerBound && flightTime <= shiftUpperBound);

        return matchesPast && matchesType && matchesSearch && matchesTerminal && matchesFocus && matchesShift;
      })
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime());
  }, [state.flights, state.showPast, state.filterTypes, state.searchQuery, state.showFocusOnly, terminalFilter, shiftStart, shiftEnd, useShiftFilter, iataSearchIndex]);

  const arrivalFlights = useMemo(() => (
    state.flights
      .filter(isArrivalFlight)
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime())
  ), [state.flights]);

  const availableArrivalCompanyOptions = useMemo(() => {
    const byId = new Map<string, ArrivalCompanyOption>();
    arrivalFlights.forEach((flight) => {
      const option = getArrivalCompanyOptionForFlight(flight);
      const existing = byId.get(option.id);
      byId.set(option.id, existing
        ? { ...existing, prefixes: Array.from(new Set([...existing.prefixes, ...option.prefixes])) }
        : option);
    });

    ARRIVAL_COMPANY_GROUPS.forEach((option) => {
      if (arrivalCompanyFilterIds.includes(option.id) && !byId.has(option.id)) {
        byId.set(option.id, option);
      }
    });

    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [arrivalFlights, arrivalCompanyFilterIds]);

  const companyArrivalFlights = useMemo(() => (
    arrivalFlights.filter((flight) => arrivalCompanyFilterIds.includes(getArrivalCompanyIdForFlight(flight)))
  ), [arrivalFlights, arrivalCompanyFilterIds]);

  const toggleArrivalCompanyFilter = (companyId: string) => {
    setArrivalCompanyFilterIds((prev) => {
      const normalized = normalizeArrivalCompanyFilterIds(prev);
      return normalized.includes(companyId)
        ? normalized.filter((id) => id !== companyId)
        : [...normalized, companyId];
    });
  };

  const updateArrivalFlight = (id: string, patch: Partial<Flight>) => {
    setState(prev => ({
      ...prev,
      flights: prev.flights.map((flight) => (
        flight.id === id ? { ...flight, ...patch } : flight
      )),
    }));
  };

  const updateArrivalTimeField = (id: string, field: 'std' | ArrivalTimeField, value: string) => {
    setState(prev => ({
      ...prev,
      flights: prev.flights.map((flight) => {
        if (flight.id !== id) {
          return flight;
        }

        if (!value.trim()) {
          if (field === 'firstBaggageAt') {
            setArrivalStats((samples) => updateArrivalStatsWithFlight(samples, flight, undefined));
          }
          return { ...flight, [field]: undefined };
        }

        const nextTime = updateStdTime(field === 'std' ? flight.std : flight[field] || flight.std, value);
        const nextFlight = { ...flight, [field]: nextTime };
        if (field === 'firstBaggageAt') {
          setArrivalStats((samples) => updateArrivalStatsWithFlight(samples, nextFlight, nextTime));
        } else if (field === 'std' && nextFlight.firstBaggageAt) {
          setArrivalStats((samples) => updateArrivalStatsWithFlight(samples, nextFlight, nextFlight.firstBaggageAt));
        }
        return nextFlight;
      }),
    }));
  };

  const handleArrivalTimeTap = (flight: Flight, field: ArrivalTimeField) => {
    if (flight[field]) {
      setArrivalTimePicker((current) => (
        current?.flightId === flight.id && current.field === field ? null : { flightId: flight.id, field }
      ));
      return;
    }

    updateArrivalTimeField(flight.id, field, formatCurrentTimeOption());
    setArrivalTimePicker({ flightId: flight.id, field });
  };

  const setArrivalPickerPart = (flight: Flight, field: ArrivalTimeField, part: 'hour' | 'minute', value: string) => {
    const currentTime = flight[field] ? formatHHmm(flight[field] || '') : formatCurrentTimeOption();
    const [currentHour, currentMinute] = currentTime.split(':');
    const nextTime = part === 'hour' ? `${value}:${currentMinute || '00'}` : `${currentHour || '00'}:${value}`;
    updateArrivalTimeField(flight.id, field, nextTime);
  };

  const renderArrivalTimeField = (flight: Flight, field: ArrivalTimeField, label: string, tone: 'green' | 'blue' | 'white' = 'white') => {
    const value = flight[field];
    const isOpen = arrivalTimePicker?.flightId === flight.id && arrivalTimePicker.field === field;
    const [selectedHour, selectedMinute] = (value ? formatHHmm(value) : formatCurrentTimeOption()).split(':');
    const activeClasses = tone === 'green'
      ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
      : tone === 'blue'
        ? 'border-sky-400/35 bg-sky-500/15 text-sky-100'
        : 'border-white/15 bg-white/[0.06] text-white';

    return (
      <div key={`${flight.id}-${field}`} className="relative">
        <button
          type="button"
          onClick={() => handleArrivalTimeTap(flight, field)}
          className={`min-h-[3.25rem] w-full rounded-xl border px-2 py-1.5 text-left transition-all ${
            value ? activeClasses : 'border-white/5 bg-white/[0.035] text-white/45'
          }`}
        >
          <div className="text-[8px] font-black uppercase tracking-[0.16em]">{label}</div>
          <div className="mt-0.5 text-lg font-black leading-none">{value ? formatHHmm(value) : '--:--'}</div>
        </button>
        {isOpen && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-white/10 bg-[#171717] p-2 shadow-2xl">
            <div className="grid grid-cols-2 gap-2">
              {([
                ['hour', ARRIVAL_TIME_HOURS, selectedHour],
                ['minute', ARRIVAL_TIME_MINUTES, selectedMinute],
              ] as const).map(([part, values, selected]) => (
                <div key={part} className="h-32 overflow-y-auto rounded-lg bg-black/30 p-1 [scroll-snap-type:y_mandatory]">
                  {values.map((option) => (
                    <button
                      key={`${part}-${option}`}
                      type="button"
                      onClick={() => setArrivalPickerPart(flight, field, part, option)}
                      className={`mb-1 block h-8 w-full rounded-md text-sm font-black [scroll-snap-align:center] ${
                        option === selected ? 'bg-emerald-500 text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setArrivalTimePicker(null)}
              className="mt-2 h-8 w-full rounded-lg bg-white/10 text-xs font-black text-white/70"
            >
              OK
            </button>
          </div>
        )}
      </div>
    );
  };

  const adjustArrivalCounter = (id: string, field: ArrivalCounterField, delta: number) => {
    setState(prev => ({
      ...prev,
      flights: prev.flights.map((flight) => {
        if (flight.id !== id) {
          return flight;
        }

        const currentValue = Number(flight[field] ?? 0);
        return { ...flight, [field]: Math.max(0, currentValue + delta) };
      }),
    }));
  };

  const hasImportedFlights = useMemo(
    () => state.flights.some((flight) => flight.id.startsWith('ocr-')),
    [state.flights],
  );
  const isLoadingSharedBoard = !hasLoadedSharedFlights;
  const shouldShowOnboardingEmptyState = !isLoadingSharedBoard && filteredFlights.length === 0 && !hasImportedFlights;
  const shouldShowFilteredEmptyState = !isLoadingSharedBoard && filteredFlights.length === 0 && hasImportedFlights;

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

  const handleDoneToggle = (id: string) => {
    setState(prev => ({
      ...prev,
      flights: prev.flights.map(flight => (
        flight.id === id
          ? { ...flight, doneAt: flight.doneAt ? undefined : new Date().toISOString() }
          : flight
      )),
    }));
  };

  const persistSharedBoardSnapshot = async (
    flights: Flight[],
    filters: SharedBoardFilters,
    stats: ArrivalFirstBaggageSample[] = arrivalStats,
  ) => {
    try {
      const response = await fetch(SHARED_FLIGHTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ flights, filters, arrivalStats: normalizeArrivalStats(stats) }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to save shared flights');
      }

      const payload = await response.json().catch(() => ({})) as SharedFlightsResponse;
      setSharedBoardStatus({
        state: 'saved',
        at: Date.now(),
        count: flights.length,
        savedAt: payload.savedAt,
      });
    } catch (error) {
      console.error('Failed to save shared flights', error);
      setSharedBoardStatus({
        state: 'save-failed',
        at: Date.now(),
        message: error instanceof Error ? error.message : 'Failed to save shared flights',
        count: flights.length,
      });
    }
  };

  const handleWatchDoneToggle = (id: string) => {
    setState(prev => {
      const nextFlights = prev.flights.map(flight => (
        flight.id === id
          ? { ...flight, doneAt: flight.doneAt ? undefined : new Date().toISOString() }
          : flight
      ));
      void persistSharedBoardSnapshot(normalizeStoredFlights(nextFlights), sharedBoardFilters);

      return {
        ...prev,
        flights: nextFlights,
      };
    });
  };

  const togglePast = () => {
    setState(prev => ({ ...prev, showPast: !prev.showPast }));
  };

  const handleScanTerminalChange = (mode: ScanTerminalMode) => {
    setScanTerminal(mode);
    if (mode === 'T1' || mode === 'T3') {
      setScanTerminalFallback(mode);
    }
  };

  const clearLocalData = () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        state.language === 'it'
          ? 'Vuoi davvero cancellare voli locali, preferenze e filtri salvati solo in questo browser?'
          : 'Do you want to clear local flights, preferences, and filters saved only in this browser?'
      );

      if (!confirmed) {
        return;
      }

      window.localStorage.removeItem(PERSISTED_STATE_KEY);
      window.localStorage.removeItem(LOCAL_BOARD_BACKUP_KEY);
    }

    skipNextSharedPersistRef.current = true;
    setState(DEFAULT_APP_STATE);
    setTerminalFilter('ALL');
    setScanTerminal('AUTO');
    setScanTerminalFallback('T1');
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
    setOcrFixFlightId(null);
    setMobileOcrPanel('flights');
    setOcrImportItems([]);
    setOcrProgress(0);
    setOcrReview(prev => {
      prev?.previews.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      return null;
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
      position: normalizeOcrPosition(flight.position),
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
    if (finalizedFlights.some(isArrivalFlight)) {
      setCurrentView('arrivals');
    }
    closeOcrReview();
  };

  const updateOcrImportItem = (id: string, patch: Partial<OCRImportProgressItem>) => {
    setOcrImportItems(prev => prev.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as File[];
    if (files.length === 0) {
      return;
    }

    setOcrError(null);
    setIsExtracting(true);
    setOcrProgress(0);
    const importItems = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      fileName: file.name,
      status: 'queued',
      progress: 0,
    })) satisfies OCRImportProgressItem[];
    setOcrImportItems(importItems);

    try {
      for (const [fileIndex, file] of files.entries()) {
        const itemId = importItems[fileIndex].id;
        setOcrImportItems(prev => prev.map((item, index) => (
          index === fileIndex ? { ...item, status: 'processing', progress: 3, message: t.processingImage } : item
        )));

        try {
          const result = await extractFlightsFromImage(file, scanTerminal === 'AUTO' ? undefined : scanTerminal, progress => {
            const progressFraction = progress <= 1 ? progress : progress / 100;
            const normalizedProgress = Math.max(0, Math.min(100, Math.round(progressFraction * 100)));
            updateOcrImportItem(itemId, {
              status: 'processing',
              progress: normalizedProgress,
              message: normalizedProgress < 55 ? t.uploadingImage : t.readingImage,
            });
            setOcrProgress(Math.round(((fileIndex + progressFraction) / files.length) * 100));
          });

          const previewUrl = URL.createObjectURL(file);
          setOcrReview(prev => {
            const nextFlights = result.flights.map(flight => {
              const position = normalizeOcrPosition(flight.position);
              const inferredTerminal = scanTerminal === 'AUTO'
                ? inferTerminalFromNonOverlappingPosition(position)
                : null;

              return {
                ...flight,
                position,
                terminal: inferredTerminal ?? flight.terminal ?? scanTerminalFallback,
                flightNumber: normalizeFlightCode(flight.flightNumber),
                selected: (flight.sourceType === 'arrival_screen' || new Date(flight.std).getTime() > Date.now()) && !flight.crossedOut,
              };
            });

            if (!prev) {
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
          updateOcrImportItem(itemId, { status: 'done', progress: 100, message: t.completedImage });
        } catch (error) {
          console.error('OCR extraction failed', error);
          const message = error instanceof Error ? error.message : 'OCR failed on this image.';
          updateOcrImportItem(itemId, { status: 'failed', progress: 100, message });
          setOcrError(message);
        }
      }
    } finally {
      setIsExtracting(false);
      setOcrProgress(100);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  };

  const getCalendarExportFlights = (kind: CalendarExportKind) => (
    kind === 'all'
      ? filteredFlights
      : filteredFlights.filter((flight) => getPositionType(flight.terminal, flight.position) === kind)
  );

  const getCalendarExportName = (kind: CalendarExportKind) => {
    if (kind === 'Scivolo') return 'scivoli';
    if (kind === 'Carosello') return 'caroselli';
    if (kind === 'Baia') return 'baie';
    return 'flights';
  };

  const handleCalendarExport = async (type: 'ics' | 'copy', kind: CalendarExportKind = 'all') => {
    if (filteredFlights.length === 0) return;

    const exportableFlights = getCalendarExportFlights(kind);
    if (exportableFlights.length === 0) {
      setCopyFeedback(t.noCalendarChangesToExport);
      setShowCalendarMenu(false);
      return;
    }

    const flightsToExport = filteredFlights.filter(
      (flight) => flight.calendarExportFingerprint !== getCalendarExportFingerprint(flight),
    ).filter((flight) => exportableFlights.some((exportFlight) => exportFlight.id === flight.id));
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
        exportSucceeded = await downloadICS(flightsToExport.map((flight) => ({...flight})), {
          updatedFlightIds,
          filename: `${getCalendarExportName(kind)}.ics`,
        });
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
    let cancelled = false;

    const loadSharedFlights = async () => {
      try {
        const response = await fetch(`${SHARED_FLIGHTS_ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
        const payload = await response.json() as SharedFlightsResponse;

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load shared flights');
        }

        if (!cancelled) {
          const sharedFlights = normalizeStoredFlights(payload.flights ?? []);
          const sharedFilters = normalizeSharedBoardFilters(payload.filters);
          const sharedArrivalStats = normalizeArrivalStats(payload.arrivalStats);
          setState((prev) => ({
            ...prev,
            flights: sharedFlights.length > 0 || prev.flights.length === 0 ? sharedFlights : prev.flights,
            filterTypes: sharedFilters.filterTypes,
            showFocusOnly: sharedFilters.showFocusOnly,
            showPast: sharedFilters.showPast,
            searchQuery: sharedFilters.searchQuery,
          }));
          setTerminalFilter(sharedFilters.terminalFilter);
          setUseShiftFilter(sharedFilters.useShiftFilter);
          setShiftStart(sharedFilters.shiftStart);
          setShiftEnd(sharedFilters.shiftEnd);
          setArrivalCompanyFilterIds(sharedFilters.arrivalCompanyFilterIds);
          setSharedBoardFilters(sharedFilters);
          setArrivalStats(sharedArrivalStats);
          setSharedBoardStatus({
            state: 'loaded',
            at: Date.now(),
            count: sharedFlights.length,
            savedAt: payload.savedAt,
          });
          setCanPersistSharedFlights(true);
          setHasLoadedSharedFlights(true);
        }
      } catch (error) {
        console.error('Failed to load shared flights', error);
        if (!cancelled) {
          setSharedBoardStatus({
            state: 'load-failed',
            at: Date.now(),
            message: error instanceof Error ? error.message : 'Failed to load shared flights',
          });
          setHasLoadedSharedFlights(true);
        }
      }
    };

    void loadSharedFlights();
    const interval = isWatchRoute ? window.setInterval(loadSharedFlights, WATCH_SHARED_REFRESH_MS) : null;

    return () => {
      cancelled = true;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [isWatchRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const filters = getSharedBoardFiltersSnapshot(state, terminalFilter, useShiftFilter, shiftStart, shiftEnd, arrivalCompanyFilterIds);
    const flights = normalizeStoredFlights(state.flights);
    const snapshot: PersistedState = {
      appState: {
        ...state,
        flights,
      },
      terminalFilter,
      scanTerminal,
      scanTerminalFallback,
      shiftStart,
      shiftEnd,
      useShiftFilter,
      connectionThreshold,
      arrivalCompanyFilterIds: normalizeArrivalCompanyFilterIds(arrivalCompanyFilterIds),
    };

    window.localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(snapshot));
    window.localStorage.setItem(LOCAL_BOARD_BACKUP_KEY, JSON.stringify({ flights, filters, arrivalStats }));
  }, [state, terminalFilter, scanTerminal, scanTerminalFallback, connectionThreshold, useShiftFilter, shiftStart, shiftEnd, arrivalStats, arrivalCompanyFilterIds]);

  useEffect(() => {
    if (isWatchRoute || !canPersistSharedFlights) {
      return;
    }

    if (skipNextSharedPersistRef.current) {
      skipNextSharedPersistRef.current = false;
      return;
    }

    const persistSharedFlights = async () => {
      const flights = normalizeStoredFlights(state.flights);
      const filters = getSharedBoardFiltersSnapshot(state, terminalFilter, useShiftFilter, shiftStart, shiftEnd, arrivalCompanyFilterIds);
      await persistSharedBoardSnapshot(flights, filters, arrivalStats);
    };

    void persistSharedFlights();
  }, [
    state.flights,
    state.filterTypes,
    state.showFocusOnly,
    state.showPast,
    terminalFilter,
    useShiftFilter,
    shiftStart,
    shiftEnd,
    isWatchRoute,
    canPersistSharedFlights,
    arrivalStats,
    arrivalCompanyFilterIds,
  ]);

  useEffect(() => {
    if (!ADR_LIVE_SYNC_ENABLED || !hasLoadedSharedFlights || state.flights.length === 0) {
      return;
    }

    let cancelled = false;

    const syncAdrFlights = async () => {
      if (adrSyncInFlightRef.current) {
        return;
      }

      adrSyncInFlightRef.current = true;

      try {
        const response = await fetch(ADR_SYNC_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            flights: normalizeStoredFlights(stateFlightsRef.current),
            filters: getSharedBoardFiltersSnapshot(state, terminalFilter, useShiftFilter, shiftStart, shiftEnd, arrivalCompanyFilterIds),
          }),
        });
        const responseText = await response.text();
        let payload: AdrSyncResponse = {};
        if (responseText.trim()) {
          try {
            payload = JSON.parse(responseText) as AdrSyncResponse;
          } catch {
            payload = { error: response.ok ? undefined : responseText.slice(0, 180) };
          }
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Live sync failed');
        }

        if (!cancelled && payload.updatedCount && payload.updatedCount > 0 && Array.isArray(payload.flights)) {
          setState((prev) => ({
            ...prev,
            flights: normalizeStoredFlights(payload.flights ?? prev.flights),
          }));
        }
        if (!cancelled) {
          setAdrSyncStatus({
            state: 'success',
            at: Date.now(),
            provider: payload.provider,
            fallbackUsed: payload.fallbackUsed,
          });
          setStatusNow(Date.now());
        }
      } catch (error) {
        console.warn('Live sync failed', error);
        if (!cancelled) {
          setAdrSyncStatus({
            state: 'failure',
            at: Date.now(),
            message: error instanceof Error ? error.message : 'Live sync failed',
          });
          setStatusNow(Date.now());
        }
      } finally {
        adrSyncInFlightRef.current = false;
      }
    };

    void syncAdrFlights();
    const interval = window.setInterval(syncAdrFlights, ADR_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    hasLoadedSharedFlights,
    state.flights.length,
    state.filterTypes,
    state.showFocusOnly,
    state.showPast,
    terminalFilter,
    useShiftFilter,
    shiftStart,
    shiftEnd,
    arrivalCompanyFilterIds,
  ]);

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
    ? [...ocrReview.flights].sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime())
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

      const updatedFlights = prev.flights.filter((flight) => flight.id !== ocrFixFlightId);
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
  const ocrImportDoneCount = ocrImportItems.filter((item) => item.status === 'done').length;
  const ocrImportFailedCount = ocrImportItems.filter((item) => item.status === 'failed').length;
  const ocrImportFinishedCount = ocrImportDoneCount + ocrImportFailedCount;
  const showOcrImportProgress = isExtracting || ocrImportItems.length > 0;
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

  const filteredGlossaryEntries = useMemo(() => {
    const query = glossaryQuery.trim().toLowerCase();
    if (!query) {
      return GLOSSARY_ENTRIES;
    }

    return GLOSSARY_ENTRIES.filter((entry) =>
      entry.code.toLowerCase().includes(query) ||
      entry.it.toLowerCase().includes(query) ||
      entry.en.toLowerCase().includes(query)
    );
  }, [glossaryQuery]);
  const adrSyncStatusLabel = adrSyncStatus
    ? adrSyncStatus.state === 'success'
      ? `Live updated ${formatMinutesAgo(adrSyncStatus.at, statusNow)}${adrSyncStatus.provider ? ` · ${adrSyncStatus.provider}${adrSyncStatus.fallbackUsed ? ' fallback' : ''}` : ''}`
      : null
    : null;
  const sharedBoardStatusLabel = sharedBoardStatus.state === 'save-failed'
    ? `Site save failed ${formatMinutesAgo(sharedBoardStatus.at, statusNow)}${getStatusMessageSuffix(sharedBoardStatus.message)}`
    : sharedBoardStatus.state === 'saved'
      ? `Site saved ${formatMinutesAgo(sharedBoardStatus.at, statusNow)}`
      : sharedBoardStatus.state === 'load-failed'
        ? `Site load failed ${formatMinutesAgo(sharedBoardStatus.at, statusNow)}${getStatusMessageSuffix(sharedBoardStatus.message)}`
        : null;

  if (isWatchRoute) {
    return (
      <WatchApp
        flights={state.flights}
        filters={sharedBoardFilters}
        connectionThreshold={connectionThreshold}
        isLoading={isLoadingSharedBoard}
        sharedStatus={sharedBoardStatus}
        onToggleDone={handleWatchDoneToggle}
      />
    );
  }

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
              {currentView === 'settings'
                ? t.settings
                : currentView === 'arrivals'
                  ? 'Arrivi TL'
                  : currentView === 'arrivalSheet'
                    ? 'Foglio Arrivi'
                    : t.appTitle}
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

      {currentView !== 'settings' && (
        <div className="border-b border-white/5 bg-[#0a0a0a] px-4 pb-3">
          <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto">
            {([
              ['board', 'Partenze'],
              ['arrivals', `Arrivi TL ${companyArrivalFlights.length ? `(${companyArrivalFlights.length})` : ''}`],
              ['arrivalSheet', 'Foglio'],
            ] as const).map(([view, label]) => (
              <button
                key={view}
                onClick={() => setCurrentView(view)}
                className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black transition-all ${
                  currentView === view
                    ? 'border-emerald-500 bg-emerald-500 text-black'
                    : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

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
              {adrSyncStatusLabel && (
                <div
                  className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${
                    adrSyncStatus?.state === 'success'
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/25 bg-rose-500/10 text-rose-300'
                  } sm:hidden`}
                >
                  {adrSyncStatusLabel}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <main className="max-w-4xl mx-auto p-4 pb-32">
        {currentView === 'settings' ? (
          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-[#111111] p-5 shadow-2xl">
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">Filtro compagnie arrivi</p>
                <p className="mt-2 text-sm text-white/50">Le compagnie importate appaiono una volta sola. W4 e W6 sono raggruppate come Wizz.</p>
              </div>
              {availableArrivalCompanyOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm font-bold text-white/40">
                  Importa una schermata arrivi per popolare la lista.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableArrivalCompanyOptions.map((company) => {
                    const selected = arrivalCompanyFilterIds.includes(company.id);
                    const count = arrivalFlights.filter((flight) => getArrivalCompanyIdForFlight(flight) === company.id).length;
                    return (
                      <button
                        key={company.id}
                        type="button"
                        onClick={() => toggleArrivalCompanyFilter(company.id)}
                        className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                          selected
                            ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                            : 'border-white/10 bg-white/[0.03] text-white/45'
                        }`}
                      >
                        <span>
                          <span className="block text-sm font-black">{company.label}</span>
                          <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                            {company.prefixes.join('/')} {count ? `· ${count}` : ''}
                          </span>
                        </span>
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          selected ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/30'
                        }`}>
                          {selected && <Check size={16} strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300">{t.glossary}</p>
                <p className="mt-2 text-sm text-white/50">{t.glossaryDescription}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                  <input
                    type="text"
                    value={glossaryQuery}
                    onChange={(event) => setGlossaryQuery(event.target.value)}
                    placeholder={t.glossarySearchPlaceholder}
                    className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-10 pr-4 text-sm text-white outline-none transition-all focus:border-cyan-400/40"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {filteredGlossaryEntries.length > 0 ? (
                    filteredGlossaryEntries.map((entry) => (
                      <div key={entry.code} className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
                        <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200">{entry.code}</div>
                        <div className="mt-1 text-sm text-white/75">
                          {state.language === 'it' ? entry.it : entry.en}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-4 text-sm text-white/45">
                      {t.glossaryNoResults}
                    </div>
                  )}
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
        ) : currentView === 'arrivals' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#111111] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-300">Team Leader</p>
                  <p className="mt-1 text-xs text-white/45">
                    Filtro: {availableArrivalCompanyOptions
                      .filter((company) => arrivalCompanyFilterIds.includes(company.id))
                      .map((company) => company.label)
                      .join(', ') || 'nessuna compagnia'}
                  </p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-white/70">
                  {companyArrivalFlights.length}/{arrivalFlights.length} arrivi
                </div>
              </div>
            </div>

            {companyArrivalFlights.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <p className="text-lg font-black text-white">Nessun arrivo compagnia</p>
                <p className="mt-2 text-sm text-white/45">Attiva una compagnia in Impostazioni, oppure importa una schermata arrivi.</p>
              </div>
            ) : (
              companyArrivalFlights.map((flight) => (
                <div key={`arrival-${flight.id}`} className="rounded-2xl border border-white/10 bg-[#111111] p-3 shadow-xl">
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xl font-black leading-none text-white">{flight.flightNumber}</span>
                        <span className="rounded-md bg-yellow-300 px-1.5 py-0.5 text-xs font-black text-black">Nastro {flight.position || '-'}</span>
                        {hasLiveDelay(flight) && (
                          <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-xs font-black text-black">
                            {getLiveDelayLabel(flight)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs font-bold text-white/55">{flight.destination}</p>
                      {(() => {
                        const prediction = getArrivalPrediction(flight, arrivalStats);
                        return prediction ? (
                          <div className="mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[11px] font-black text-sky-100">
                            <span>Prev. {formatHHmm(prediction.predictedAt)}</span>
                            <span className="text-sky-200/70">+{prediction.delayMinutes}</span>
                            <span className="text-white/30">
                              {prediction.strongSampleCount}/{prediction.sampleCount} simili
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1.5 text-[11px] font-bold text-white/30">
                            Prev. dopo dati salvati
                          </div>
                        );
                      })()}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2 text-right">
                      <div className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Eff.</div>
                      <input
                        value={formatHHmm(flight.std)}
                        onChange={(event) => updateArrivalTimeField(flight.id, 'std', event.target.value)}
                        className="mt-0.5 w-16 bg-transparent text-right text-lg font-black leading-none text-emerald-200 outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {renderArrivalTimeField(flight, 'arrivalReceivedAt', 'Arrivo', 'blue')}
                    {renderArrivalTimeField(flight, 'firstBaggageAt', 'Prima', 'green')}
                    {renderArrivalTimeField(flight, 'secondEntryAt', '2a')}
                    {renderArrivalTimeField(flight, 'thirdEntryAt', '3a')}
                    {renderArrivalTimeField(flight, 'endAt', 'Fine')}
                  </div>
                  {flight.firstBaggageAt && (
                    <div className="mt-1.5 text-[11px] font-bold text-emerald-200">
                      Prima salvata +{getArrivalFirstBaggageDelayMinutes(flight) ?? 0}m
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {([
                      ['Carr.', 'carts'],
                      ['AKH', 'akh'],
                      ['AKE', 'ake'],
                    ] as const).map(([label, field]) => (
                      <div key={field} className="rounded-xl border border-white/5 bg-white/[0.03] p-2">
                        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/35">{label}</div>
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <button onClick={() => adjustArrivalCounter(flight.id, field, -1)} className="h-7 w-7 rounded-lg bg-white/10 text-base font-black text-white">-</button>
                          <span className="text-base font-black text-white">{flight[field] ?? 0}</span>
                          <button onClick={() => adjustArrivalCounter(flight.id, field, 1)} className="h-7 w-7 rounded-lg bg-emerald-500 text-base font-black text-black">+</button>
                        </div>
                      </div>
                    ))}
                    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2">
                      <button
                        onClick={() => updateArrivalFlight(flight.id, { hasTransit: !flight.hasTransit, transitBags: flight.hasTransit ? 0 : flight.transitBags ?? 0 })}
                        className={`h-6 w-full rounded-lg text-[10px] font-black ${flight.hasTransit ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60'}`}
                      >
                        Transiti
                      </button>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <button onClick={() => adjustArrivalCounter(flight.id, 'transitBags', -1)} className="h-7 w-7 rounded-lg bg-white/10 text-base font-black text-white">-</button>
                        <span className="text-base font-black text-white">{flight.transitBags ?? 0}</span>
                        <button onClick={() => adjustArrivalCounter(flight.id, 'transitBags', 1)} className="h-7 w-7 rounded-lg bg-emerald-500 text-base font-black text-black">+</button>
                      </div>
                    </div>
                  </div>

                  <label className="mt-3 block rounded-xl border border-white/5 bg-white/[0.03] p-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/35">Note</span>
                      <input
                        value={flight.teamLeaderNote || ''}
                        onChange={(event) => updateArrivalFlight(flight.id, { teamLeaderNote: event.target.value })}
                        placeholder="Note"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-sm font-bold text-white outline-none"
                      />
                  </label>
                </div>
              ))
            )}
          </div>
        ) : currentView === 'arrivalSheet' ? (
          <div className="overflow-auto rounded-xl bg-white p-3 text-black">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-black">
                  {['Volo', 'Provenienza', 'Nastro', 'Eff.', 'Arrivo', 'Prima prev.', 'Prima reale', 'Ritardo', '2a entrata', '3a entrata', 'Fine', 'Carrelli', 'AKH', 'AKE', 'Transiti', 'Note'].map((heading) => (
                    <th key={heading} className="border border-black px-2 py-1 text-left font-black">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companyArrivalFlights.map((flight) => (
                  <tr key={`arrival-sheet-${flight.id}`}>
                    <td className="border border-black px-2 py-1 font-bold">{flight.flightNumber}</td>
                    <td className="border border-black px-2 py-1">{flight.destination}</td>
                    <td className="border border-black px-2 py-1">{flight.position}</td>
                    <td className="border border-black px-2 py-1">{formatHHmm(flight.std)}</td>
                    <td className="border border-black px-2 py-1">{flight.arrivalReceivedAt ? formatHHmm(flight.arrivalReceivedAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{getArrivalPrediction(flight, arrivalStats) ? formatHHmm(getArrivalPrediction(flight, arrivalStats)!.predictedAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.firstBaggageAt ? formatHHmm(flight.firstBaggageAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{hasLiveDelay(flight) ? getLiveDelayLabel(flight) : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.secondEntryAt ? formatHHmm(flight.secondEntryAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.thirdEntryAt ? formatHHmm(flight.thirdEntryAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.endAt ? formatHHmm(flight.endAt) : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.carts ?? ''}</td>
                    <td className="border border-black px-2 py-1">{flight.akh ?? ''}</td>
                    <td className="border border-black px-2 py-1">{flight.ake ?? ''}</td>
                    <td className="border border-black px-2 py-1">{flight.hasTransit ? flight.transitBags ?? 0 : ''}</td>
                    <td className="border border-black px-2 py-1">{flight.teamLeaderNote || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            multiple
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

        {sharedBoardStatusLabel && (
          <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
            sharedBoardStatus.state === 'save-failed' || sharedBoardStatus.state === 'load-failed'
              ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
          }`}>
            {sharedBoardStatusLabel}
          </div>
        )}

        {showOcrImportProgress && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-[#111111] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">{t.importProgress}</p>
                <p className="mt-1 text-xs text-white/45">
                  {ocrImportFinishedCount}/{ocrImportItems.length} {t.imagesProcessed}
                  {ocrImportFailedCount > 0 ? ` - ${ocrImportFailedCount} ${t.failedImages}` : ''}
                </p>
              </div>
              {isExtracting && <Loader2 size={18} className="shrink-0 animate-spin text-emerald-300" />}
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, ocrProgress))}%` }}
              />
            </div>
            <div className="space-y-2">
              {ocrImportItems.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                    item.status === 'failed'
                      ? 'bg-rose-500/15 text-rose-200'
                      : item.status === 'done'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : 'bg-white/10 text-white/50'
                  }`}>
                    {item.status === 'done' ? <Check size={14} /> : item.status === 'failed' ? <X size={14} /> : index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-bold text-white/80">{item.fileName}</p>
                      <p className="shrink-0 text-[10px] font-black uppercase text-white/35">
                        {item.status === 'queued' ? t.queuedImage : item.message ?? `${item.progress}%`}
                      </p>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all ${item.status === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
                      {SCAN_TERMINAL_OPTIONS.map((term) => (
                        <button
                          key={term}
                          onClick={() => handleScanTerminalChange(term)}
                          className={`flex-1 px-4 py-3 rounded-full text-xs font-black transition-all ${
                            scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                          }`}
                        >
                          {getScanTerminalLabel(term, t)}
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
                  onToggleDone={handleDoneToggle}
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
                          {SCAN_TERMINAL_OPTIONS.map((term) => (
                            <button
                              key={term}
                              onClick={() => handleScanTerminalChange(term)}
                              className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-bold transition-all ${
                                scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                              }`}
                              aria-label={`${t.scanTerminalLabel}: ${getScanTerminalLabel(term, t)}`}
                            >
                              {getScanTerminalLabel(term, t)}
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
                            <span className="text-[10px] text-white/40">{getScanTerminalLabel(scanTerminal, t)}</span>
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
                            <span className="text-[10px] text-white/40">{getScanTerminalLabel(scanTerminal, t)}</span>
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
                      <div className="mt-1 grid grid-cols-3 gap-1 px-1">
                        {([
                          ['Scivolo', t.scivoli],
                          ['Carosello', t.caroselli],
                          ['Baia', t.baie],
                        ] as const).map(([kind, label]) => {
                          const count = getCalendarExportFlights(kind).filter(
                            (flight) => flight.calendarExportFingerprint !== getCalendarExportFingerprint(flight),
                          ).length;

                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => handleCalendarExport('ics', kind)}
                              disabled={count === 0}
                              className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-[9px] font-black uppercase tracking-wide text-white/60 transition-all hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              {label}
                              <span className="ml-1 text-white/30">{count}</span>
                            </button>
                          );
                        })}
                      </div>
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
                  {showOcrImportProgress && (
                    <div className="border-b border-white/5 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-300">{t.importProgress}</p>
                        <p className="text-[10px] font-black text-white/45">
                          {ocrImportFinishedCount}/{ocrImportItems.length} {t.imagesProcessed}
                        </p>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {ocrImportItems.map((item, index) => (
                          <div key={`modal-${item.id}`} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${
                              item.status === 'failed'
                                ? 'bg-rose-500/15 text-rose-200'
                                : item.status === 'done'
                                  ? 'bg-emerald-500/15 text-emerald-200'
                                  : 'bg-white/10 text-white/50'
                            }`}>
                              {item.status === 'done' ? <Check size={12} /> : item.status === 'failed' ? <X size={12} /> : index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-[11px] font-bold text-white/75">{item.fileName}</p>
                                <p className="shrink-0 text-[9px] font-black uppercase text-white/35">
                                  {item.status === 'queued' ? t.queuedImage : item.message ?? `${item.progress}%`}
                                </p>
                              </div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className={`h-full rounded-full transition-all ${item.status === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'}`}
                                  style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                        <div className="p-4 pb-0">
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
                    <span>{t.parsedFlights}</span>
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
