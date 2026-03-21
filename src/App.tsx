import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Flight, OCRFlightCandidate } from './types';
import { MOCK_FLIGHTS, TRANSLATIONS, getPositionType } from './constants';
import { Clock } from './components/Clock';
import { FlightCard, FlightCardExpandedContent } from './components/FlightCard';
import { formatDuration, formatHHmm, getMinutesToTarget, getUrgencyColor } from './utils/timeUtils';
import { copyFlightsToClipboard, downloadICS } from './utils/calendarUtils';
import { extractFlightsFromImage } from './services/ocrService';
import { Filter, Calendar as CalendarIcon, Plane, Search, X, Download, Copy, Camera, Loader2, ScanText, TriangleAlert, Square, CheckSquare, Plus, Clock as ClockIcon, ChevronDown, ChevronUp, Settings, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type OCRReviewFlight = OCRFlightCandidate & { selected: boolean };
type OCRReviewPreview = { previewUrl: string; fileName: string };
type OCRReviewState = { flights: OCRReviewFlight[]; text: string; previews: OCRReviewPreview[] };
type MergeStatus = 'new' | 'update';

type OCRPreviewCardProps = {
  flight: OCRReviewFlight;
  onToggle: (id: string) => void;
  t: any;
  mergeStatus: MergeStatus;
};

const getFlightMatchKey = (flight: Pick<Flight, 'flightNumber' | 'destination' | 'std' | 'terminal'>) => {
  const date = new Date(flight.std);
  const localDay = Number.isNaN(date.getTime()) ? flight.std.slice(0, 10) : date.toLocaleDateString('sv-SE');
  const time = Number.isNaN(date.getTime()) ? flight.std : formatHHmm(flight.std);
  return [
    flight.flightNumber.trim().toUpperCase(),
    flight.destination.trim().toUpperCase(),
    flight.terminal.trim().toUpperCase(),
    localDay,
    time,
  ].join('|');
};

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
  position: pickPreferredValue(base.position, incoming.position) || base.position,
  fc: pickPreferredValue(base.fc, incoming.fc) || undefined,
  richiesta: pickPreferredValue(base.richiesta, incoming.richiesta) || undefined,
  tot: pickPreferredValue(base.tot, incoming.tot) || undefined,
});

const mergeOcrFlightLists = (existing: OCRReviewFlight[], incoming: OCRReviewFlight[]) => {
  const merged = [...existing];
  const indexByKey = new Map(merged.map((flight, index) => [getFlightMatchKey(flight), index]));

  incoming.forEach((flight) => {
    const matchKey = getFlightMatchKey(flight);
    const existingIndex = indexByKey.get(matchKey);

    if (existingIndex === undefined) {
      indexByKey.set(matchKey, merged.length);
      merged.push(flight);
      return;
    }

    const current = merged[existingIndex];
    merged[existingIndex] = {
      ...mergeFlightData(current, flight),
      confidence: Math.max(current.confidence, flight.confidence),
      sourceLine: pickPreferredValue(current.sourceLine, flight.sourceLine),
      crossedOut: current.crossedOut || flight.crossedOut || undefined,
      selected: current.selected && !flight.crossedOut,
    };
  });

  return merged;
};

const mergeIntoBoardFlights = (existingFlights: Flight[], incomingFlights: OCRReviewFlight[]) => {
  const mergedFlights = [...existingFlights];
  const indexByKey = new Map(mergedFlights.map((flight, index) => [getFlightMatchKey(flight), index]));

  incomingFlights.forEach((flight) => {
    const matchKey = getFlightMatchKey(flight);
    const existingIndex = indexByKey.get(matchKey);

    if (existingIndex === undefined) {
      indexByKey.set(matchKey, mergedFlights.length);
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

const OCRPreviewCard: React.FC<OCRPreviewCardProps> = ({flight, onToggle, t, mergeStatus}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const minutesToTarget = getMinutesToTarget(flight.std);
  const minutesToSTD = Math.floor((new Date(flight.std).getTime() - Date.now()) / 60000);
  const urgencyColor = getUrgencyColor(minutesToSTD);
  const stdCountdown = formatDuration(minutesToSTD);
  const posType = getPositionType(flight.terminal, flight.position);

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

  return (
    <motion.div
      layout
      className={`rounded-xl border shadow-lg relative ${flight.selected ? 'border-emerald-500/20 bg-[#1a1a1a]' : 'border-white/8 bg-[#141414] opacity-70'}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer" onClick={() => setIsExpanded(prev => !prev)}>
          <div
            className="w-16 h-16 rounded-lg flex flex-col items-center justify-center text-white font-bold shadow-lg shrink-0"
            style={{ backgroundColor: urgencyColor }}
          >
            <span className="text-2xl leading-none">{flight.position || 'X'}</span>
            <span className="text-[14px] font-black uppercase mt-0.5">{flight.destination}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-[14px] truncate">{flight.flightNumber}</span>
              {flight.crossedOut && (
                <span className="rounded-full border border-rose-400/20 bg-rose-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-200">
                  {t.crossedOut}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                  mergeStatus === 'update'
                    ? 'border border-blue-400/20 bg-blue-500/15 text-blue-200'
                    : 'border border-emerald-400/20 bg-emerald-500/15 text-emerald-200'
                }`}
              >
                {mergeStatus === 'update' ? t.updatesExisting : t.newFlight}
              </span>
            </div>

            {(flight.fc || flight.richiesta || flight.tot) && !isExpanded && (
              <div className="mt-0.5 text-[9px] leading-tight max-w-[180px] truncate whitespace-nowrap">
                {flight.fc && <span className="text-white/70 font-black mr-1.5">{flight.fc}</span>}
                {flight.richiesta && <span className="text-white/60 font-medium italic mr-1.5">{flight.richiesta}</span>}
                {flight.tot && <span className="text-white/30 font-bold">{flight.tot}</span>}
              </div>
            )}

            <div className="flex items-center gap-4 mt-1 text-[9px] text-white/50">
              <div className="flex items-center gap-1">
                <ClockIcon size={10} />
                <span>STD: {formatHHmm(flight.std)}</span>
              </div>
            </div>
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
            className="border-t border-white/5 bg-black/20 overflow-hidden"
          >
            <FlightCardExpandedContent
              flight={flight}
              posType={posType}
              t={t}
              confidence={flight.confidence}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default function App() {
  const [currentView, setCurrentView] = useState<'board' | 'settings'>('board');
  const [state, setState] = useState<AppState>({
    flights: MOCK_FLIGHTS,
    language: 'it',
    showPast: false,
    filterType: 'All',
    searchQuery: '',
    showFocusOnly: false,
    showMockFlights: false
  });
  const [terminalFilter, setTerminalFilter] = useState<'ALL' | 'T1' | 'T3'>('ALL');
  const [scanTerminal, setScanTerminal] = useState<'T1' | 'T3'>('T1');
  const [connectionThreshold, setConnectionThreshold] = useState<5 | 10>(10);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrReview, setOcrReview] = useState<OCRReviewState | null>(null);
  const [ocrReviewTypeFilter, setOcrReviewTypeFilter] = useState<'All' | 'Scivolo' | 'Nastro'>('All');
  const [mobileOcrPanel, setMobileOcrPanel] = useState<'flights' | 'photo'>('flights');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [scanLoadingIndex, setScanLoadingIndex] = useState(0);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrReviewRef = useRef<OCRReviewState | null>(null);

  const t = TRANSLATIONS[state.language];

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
        const matchesType = state.filterType === 'All' || posType === state.filterType;
        const matchesTerminal = terminalFilter === 'ALL' || f.terminal === terminalFilter;
        
        const matchesSearch = !query || 
          f.flightNumber.toLowerCase().includes(query) ||
          f.destination.toLowerCase().includes(query) ||
          f.position.toLowerCase().includes(query);

        const minutesToSTD = Math.floor((new Date(f.std).getTime() - Date.now()) / 60000);
        const isFocused = minutesToSTD >= 30 && minutesToSTD <= 90;
        const matchesFocus = !state.showFocusOnly || isFocused;

        return matchesMockVisibility && matchesPast && matchesType && matchesSearch && matchesTerminal && matchesFocus;
      })
      .sort((a, b) => new Date(a.std).getTime() - new Date(b.std).getTime());
  }, [state.flights, state.showPast, state.filterType, state.searchQuery, state.showFocusOnly, state.showMockFlights, terminalFilter]);

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

  const closeOcrReview = () => {
    setOcrReviewTypeFilter('All');
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

  const toggleAllOcrCandidates = (selected: boolean) => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        flights: prev.flights.map(flight => ({...flight, selected})),
      };
    });
  };

  const setOcrSelectionByType = (type: 'Scivolo' | 'Nastro') => {
    setOcrReview(prev => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        flights: prev.flights.map(flight => ({
          ...flight,
          selected: getPositionType(flight.terminal, flight.position) === type,
        })),
      };
    });
    setOcrReviewTypeFilter(type);
  };

  const handleImportFlights = () => {
    if (!ocrReview) {
      return;
    }

    const selectedFlights = ocrReview.flights.filter(flight => flight.selected);
    if (selectedFlights.length === 0) {
      return;
    }

    setState(prev => ({
      ...prev,
      flights: mergeIntoBoardFlights(prev.flights, selectedFlights),
      searchQuery: '',
      showFocusOnly: false,
      filterType: 'All',
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
          selected: new Date(flight.std).getTime() > Date.now() && !flight.crossedOut,
        }));

        if (!prev) {
          setOcrReviewTypeFilter('All');
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
    }
  };

  const handleCalendarExport = async (type: 'ics' | 'copy') => {
    if (filteredFlights.length === 0) return;
    
    if (type === 'ics') {
      downloadICS(filteredFlights);
      setCopyFeedback(null);
    } else {
      try {
        const copied = await copyFlightsToClipboard(filteredFlights);
        setCopyFeedback(copied ? t.copiedEventText : t.clipboardCopyFailed);
      } catch (error) {
        console.error('Clipboard copy failed', error);
        setCopyFeedback(t.clipboardCopyFailed);
      }
    }
    setShowCalendarMenu(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(event.target as Node)) {
        setShowCalendarMenu(false);
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
  const existingBoardFlightKeys = useMemo(
    () => new Set(state.flights.map((flight) => getFlightMatchKey(flight))),
    [state.flights],
  );
  const visibleOcrFlights = ocrReview
    ? ocrReview.flights.filter((flight) => (
        ocrReviewTypeFilter === 'All' || getPositionType(flight.terminal, flight.position) === ocrReviewTypeFilter
      ))
    : [];
  const latestOcrPreview = ocrReview ? ocrReview.previews[ocrReview.previews.length - 1] : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="bg-[#0a0a0a] px-4 pt-6 pb-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Plane className="text-black" size={24} />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic">
              {currentView === 'settings' ? t.settings : t.appTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {currentView === 'settings' ? (
              <button
                onClick={() => setCurrentView('board')}
                className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
              >
                <ArrowLeft size={14} />
                {t.backToBoard}
              </button>
            ) : (
              <button
                onClick={() => setCurrentView('settings')}
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
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Controls */}
        <div className="flex flex-wrap gap-2 mb-6">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            capture="environment"
            className="hidden"
          />
          <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
            {(['T1', 'T3'] as const).map((term) => (
              <button
                key={term}
                onClick={() => setScanTerminal(term)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                  scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                }`}
              >
                {term}
              </button>
            ))}
          </div>

          <button 
            onClick={togglePast}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
              state.showPast 
                ? 'bg-white text-black border-white' 
                : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
            }`}
          >
            <Filter size={14} />
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
            {t.focusLabel} (30-90m)
          </button>

          <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
            {(['All', 'Scivolo', 'Nastro'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setState(prev => ({ ...prev, filterType: type }))}
                className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                  state.filterType === type 
                    ? 'bg-emerald-500 text-black' 
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {type === 'All' ? t.all : type.toUpperCase()}
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
                {term}
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
          {filteredFlights.length === 0 ? (
            <div className="py-12">
              <div className="mx-auto max-w-xl rounded-[28px] border border-white/10 bg-[#111111] px-6 py-10 text-center shadow-2xl">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/10 border border-emerald-500/20">
                  <Camera size={34} className="text-emerald-300" />
                </div>
                <p className="text-xl font-black text-white">{t.noFlightsScheduled}</p>
                <p className="mx-auto mt-3 max-w-md text-sm text-white/50">{t.emptyStateHint}</p>
                <div className="mt-6">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">{t.scanTerminalLabel}</p>
                  <div className="mx-auto inline-flex bg-white/5 p-1 rounded-full border border-white/10">
                    {(['T1', 'T3'] as const).map((term) => (
                      <button
                        key={term}
                        onClick={() => setScanTerminal(term)}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                          scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                        }`}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExtracting}
                  className="mx-auto mt-6 inline-flex items-center gap-3 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                  {isExtracting ? SCAN_LOADING_MESSAGES[scanLoadingIndex] : t.emptyStateAction}
                </button>
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

              // Calculate focus index (1, 2, 3...) for flights in the 30-90m window
              const focusedFlights = filteredFlights.filter(f => {
                const m = Math.floor((new Date(f.std).getTime() - Date.now()) / 60000);
                return m >= 30 && m <= 90;
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
                  onTagToggle={handleTagToggle}
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
                <>
                  <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 items-center">
                    {(['T1', 'T3'] as const).map((term) => (
                      <button
                        key={term}
                        onClick={() => setScanTerminal(term)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-bold transition-all ${
                          scanTerminal === term ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
                        }`}
                        aria-label={`${t.scanTerminalLabel}: ${term}`}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isExtracting}
                    className={`px-3 rounded-xl transition-all flex items-center gap-2 ${
                      isExtracting
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    } disabled:opacity-70`}
                    aria-label={t.scanSheet}
                  >
                    {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {isExtracting ? SCAN_LOADING_MESSAGES[scanLoadingIndex] : `${t.scanSheet} ${scanTerminal}`}
                    </span>
                  </button>
                </>
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
                  onClick={() => setShowCalendarMenu(!showCalendarMenu)}
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
                className="flex h-[90vh] w-full max-w-6xl flex-col gap-4 overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] p-4 shadow-2xl"
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
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isExtracting}
                        className="rounded-xl border border-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500/10 disabled:opacity-60"
                      >
                        <span className="inline-flex items-center gap-2">
                          {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                          {t.addImage}
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
                  <div className="hidden min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid lg:grid-cols-[0.85fr_1.15fr]">
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
                          {ocrReview.text.trim() || t.noOcrTextRecognized}
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
                              ocrReviewTypeFilter === 'Scivolo'
                                ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                                : 'border-amber-500/20 text-amber-200 hover:bg-amber-500/10'
                            }`}
                          >
                            {t.onlyScivoli}
                          </button>
                          <button
                            onClick={() => setOcrSelectionByType('Nastro')}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrReviewTypeFilter === 'Nastro'
                                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                                : 'border-cyan-500/20 text-cyan-200 hover:bg-cyan-500/10'
                            }`}
                          >
                            {t.onlyNastri}
                          </button>
                          <button
                            onClick={() => {
                              setOcrReviewTypeFilter('All');
                              toggleAllOcrCandidates(true);
                            }}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-all ${
                              ocrReviewTypeFilter === 'All'
                                ? 'border-white/20 bg-white/10 text-white'
                                : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {t.all}
                          </button>
                          <button
                            onClick={() => toggleAllOcrCandidates(false)}
                            className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
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
                              t={t}
                              mergeStatus={existingBoardFlightKeys.has(getFlightMatchKey(flight)) ? 'update' : 'new'}
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
                                ocrReviewTypeFilter === 'Scivolo'
                                  ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                                  : 'border-amber-500/20 text-amber-200 hover:bg-amber-500/10'
                              }`}
                            >
                              {t.onlyScivoli}
                            </button>
                            <button
                              onClick={() => setOcrSelectionByType('Nastro')}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrReviewTypeFilter === 'Nastro'
                                  ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                                  : 'border-cyan-500/20 text-cyan-200 hover:bg-cyan-500/10'
                              }`}
                            >
                              {t.onlyNastri}
                            </button>
                            <button
                              onClick={() => {
                                setOcrReviewTypeFilter('All');
                                toggleAllOcrCandidates(true);
                              }}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                                ocrReviewTypeFilter === 'All'
                                  ? 'border-white/20 bg-white/10 text-white'
                                  : 'border-white/10 text-white/70 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              {t.all}
                            </button>
                            <button
                              onClick={() => toggleAllOcrCandidates(false)}
                              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
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
                                  t={t}
                                  mergeStatus={existingBoardFlightKeys.has(getFlightMatchKey(flight)) ? 'update' : 'new'}
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
                            {ocrReview.text.trim() || t.noOcrTextRecognized}
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
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
