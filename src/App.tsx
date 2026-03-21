import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, OCRExtractionResult, OCRFlightCandidate } from './types';
import { MOCK_FLIGHTS, TRANSLATIONS, getPositionType } from './constants';
import { Clock } from './components/Clock';
import { FlightCard } from './components/FlightCard';
import { getUrgencyColor } from './utils/timeUtils';
import { copyFlightsToClipboard, downloadICS } from './utils/calendarUtils';
import { extractFlightsFromImage } from './services/ocrService';
import { Languages, Filter, Calendar as CalendarIcon, Plane, Search, X, Download, Copy, Camera, Loader2, ScanText, TriangleAlert, Square, CheckSquare, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type OCRReviewFlight = OCRFlightCandidate & { selected: boolean };

export default function App() {
  const [state, setState] = useState<AppState>({
    flights: MOCK_FLIGHTS,
    language: 'it',
    showPast: false,
    filterType: 'All',
    searchQuery: '',
    showFocusOnly: false,
    showMockFlights: true
  });
  const [terminalFilter, setTerminalFilter] = useState<'ALL' | 'T1' | 'T2'>('ALL');
  const [connectionThreshold, setConnectionThreshold] = useState<5 | 10>(10);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrReview, setOcrReview] = useState<({ flights: OCRReviewFlight[]; text: string; previewUrl: string; fileName: string }) | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const toggleLanguage = () => {
    setState(prev => ({ ...prev, language: prev.language === 'it' ? 'en' : 'it' }));
  };

  const togglePast = () => {
    setState(prev => ({ ...prev, showPast: !prev.showPast }));
  };

  const closeOcrReview = () => {
    setOcrReview(prev => {
      if (prev?.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
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
      flights: [...selectedFlights, ...prev.flights],
    }));
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
    closeOcrReview();

    try {
      const result = await extractFlightsFromImage(file, progress => {
        setOcrProgress(progress);
      });

      const previewUrl = URL.createObjectURL(file);
      setOcrReview({
        text: result.text,
        flights: result.flights.map(flight => ({...flight, selected: true})),
        previewUrl,
        fileName: file.name,
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
        setCopyFeedback(copied ? 'Copied event text.' : 'Clipboard copy failed.');
      } catch (error) {
        console.error('Clipboard copy failed', error);
        setCopyFeedback('Clipboard copy failed.');
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

  useEffect(() => () => {
    if (ocrReview?.previewUrl) {
      URL.revokeObjectURL(ocrReview.previewUrl);
    }
  }, [ocrReview]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timer = window.setTimeout(() => setCopyFeedback(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const selectedOcrCount = ocrReview ? ocrReview.flights.filter(flight => flight.selected).length : 0;

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
              {t.appTitle}
            </h1>
          </div>
          <Clock />
        </div>
      </header>

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

      <main className="max-w-4xl mx-auto p-4 pb-32">
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isExtracting}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-60"
          >
            {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {isExtracting ? `OCR ${Math.round(ocrProgress * 100)}%` : 'Scan Sheet'}
          </button>

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
            onClick={() => setState(prev => ({ ...prev, showMockFlights: !prev.showMockFlights }))}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
              state.showMockFlights
                ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                : 'bg-emerald-500 text-black border-emerald-500'
            }`}
          >
            {state.showMockFlights ? 'Hide Dummy' : 'Show Dummy'}
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
            FOCUS (30-90m)
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
                {type === 'All' ? 'TUTTI' : type.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
            {(['ALL', 'T1', 'T2'] as const).map((term) => (
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
          
          <button 
            onClick={toggleLanguage}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 transition-all"
          >
            <Languages size={14} />
            {state.language.toUpperCase()}
          </button>
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
            <div className="text-center py-20 text-white/20">
              <Plane size={48} className="mx-auto mb-4 opacity-10" />
              <p>No flights scheduled</p>
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
      </main>

      {/* Bottom Bar */}
      <div className="fixed bottom-6 right-6 z-[100] pointer-events-none">
        <div className="flex justify-end pointer-events-auto">
          <div className="bg-[#1a1a1a]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex gap-2 shadow-2xl">
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
                        {state.language === 'it' ? 'Esporta' : 'Export'} ({filteredFlights.length} {state.language === 'it' ? 'voli' : 'flights'})
                      </p>
                    </div>
                    <button 
                      onClick={() => handleCalendarExport('ics')}
                      className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left"
                    >
                      <Download size={16} className="text-blue-400" />
                      <div className="flex flex-col">
                        <span className="font-bold">Apple / Outlook / ICS</span>
                        <span className="text-[10px] text-white/40">{state.language === 'it' ? 'Scarica file per importazione multipla' : 'Download file for bulk import'}</span>
                      </div>
                    </button>
                    <div className="px-3 py-2 bg-white/[0.02] rounded-xl mt-1">
                      <p className="text-[9px] text-white/30 leading-relaxed italic">
                        {state.language === 'it' 
                          ? 'Su mobile: scarica il file ICS e aprilo per aggiungere tutti i voli al calendario di sistema.' 
                          : 'On mobile: download the ICS file and open it to add all flights to your system calendar.'}
                      </p>
                    </div>
                    <button 
                      onClick={() => handleCalendarExport('copy')}
                      className="w-full flex items-center gap-3 p-3 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-xl transition-all text-left"
                    >
                      <Copy size={16} className="text-emerald-400" />
                      <div className="flex flex-col">
                        <span className="font-bold">Copy for AI</span>
                        <span className="text-[10px] text-white/40">
                          {state.language === 'it' ? 'Copia testo eventi per i voli visibili' : 'Copy event text for visible flights'}
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
                className="grid h-[90vh] w-full max-w-6xl gap-4 overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] p-4 shadow-2xl lg:grid-cols-[0.92fr_1.08fr]"
              >
                <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                  <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">OCR Review</p>
                      <p className="text-sm text-white/60">{ocrReview.fileName}</p>
                    </div>
                    <button
                      onClick={closeOcrReview}
                      className="rounded-xl p-2 text-white/40 transition-all hover:bg-white/5 hover:text-white"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[0.85fr_1.15fr]">
                    <div className="space-y-3">
                      <img
                        src={ocrReview.previewUrl}
                        alt="Uploaded flight sheet"
                        className="w-full rounded-2xl border border-white/10 object-cover"
                      />
                      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">
                          <ScanText size={14} />
                          Raw OCR Text
                        </div>
                        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
                          {ocrReview.text.trim() || 'No text was recognized from this image.'}
                        </pre>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03]">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="p-4 pb-0">
                          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300">Parsed Flights</p>
                          <p className="text-sm text-white/50">Uncheck anything you do not want to add.</p>
                        </div>
                        <div className="flex items-center gap-2 p-4 pb-0">
                          <button
                            onClick={() => toggleAllOcrCandidates(true)}
                            className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                          >
                            All
                          </button>
                          <button
                            onClick={() => toggleAllOcrCandidates(false)}
                            className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                          >
                            None
                          </button>
                          <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-white/70">
                            {selectedOcrCount}/{ocrReview.flights.length}
                          </div>
                        </div>
                      </div>

                      {ocrReview.flights.length === 0 ? (
                        <div className="mx-4 mb-4 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/40">
                          No complete flights were parsed. Try a straighter image with full rows visible.
                        </div>
                      ) : (
                        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                          <div className="space-y-3">
                          {ocrReview.flights.map((flight: OCRReviewFlight) => (
                            <div key={flight.id} className={`rounded-2xl border p-4 transition-all ${flight.selected ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-white/8 bg-black/20 opacity-70'}`}>
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg font-black tracking-tight text-white">{flight.position || 'X'}</span>
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                                      {flight.destination}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-white/65">{flight.flightNumber}</p>
                                  <p className="mt-1 text-xs text-white/40">{flight.sourceLine}</p>
                                </div>
                                <button
                                  onClick={() => toggleOcrCandidate(flight.id)}
                                  className="rounded-xl p-2 text-white/30 transition-all hover:bg-white/5 hover:text-white"
                                >
                                  {flight.selected ? <CheckSquare size={18} className="text-emerald-300" /> : <Square size={18} />}
                                </button>
                              </div>
                              <div className="grid gap-2 text-xs text-white/70 sm:grid-cols-4">
                                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                  <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">STD</span>
                                  {new Date(flight.std).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                </div>
                                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                  <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">Terminal</span>
                                  {flight.terminal}
                                </div>
                                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                  <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">Position</span>
                                  {flight.position || 'X'}
                                </div>
                                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                  <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">Confidence</span>
                                  {Math.round(flight.confidence * 100)}%
                                </div>
                              </div>
                              {(flight.fc || flight.richiesta || flight.tot) && (
                                <div className="mt-2 grid gap-2 text-xs text-white/65 sm:grid-cols-3">
                                  <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                    <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">FC</span>
                                    {flight.fc || '-'}
                                  </div>
                                  <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                    <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">Richiesta</span>
                                    {flight.richiesta || '-'}
                                  </div>
                                  <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                    <span className="block text-[10px] uppercase tracking-[0.2em] text-white/30">TOT</span>
                                    {flight.tot || '-'}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/35">Add To Board</p>
                    <p className="mt-2 text-xs text-white/50">
                      Checked rows will be added to the live departures list.
                    </p>
                  </div>
                  <div className="border-t border-white/5 bg-black/30 p-3">
                    <div className="flex items-center justify-between text-xs text-white/50">
                      <span>Selected</span>
                      <span className="font-black text-white">{selectedOcrCount}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={closeOcrReview}
                        className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImportFlights}
                        disabled={selectedOcrCount === 0}
                        className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Plus size={14} />
                          Add
                        </span>
                      </button>
                    </div>
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
