
import React, { useEffect, useState } from 'react';
import { Flight } from '../types';
import { getPositionType } from '../constants';
import { getMinutesToTarget, getUrgencyColor, formatHHmm, formatDuration } from '../utils/timeUtils';
import { getCommonIataCityName, getIataCityName } from '../utils/iataLookup';
import { ChevronDown, ChevronUp, Clock as ClockIcon, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FlightCardExpandedContentProps {
  flight: Flight;
  posType: string;
  t: any;
  language: 'it' | 'en';
  confidence?: number;
}

const parseContainerRequest = (request?: string) => {
  const raw = request?.trim() ?? '';
  if (!raw) {
    return { badges: [] as string[], notes: [] as string[], raw: '' };
  }

  const notes = Array.from(raw.matchAll(/\(([^)]+)\)/g))
    .map((match) => match[1].trim())
    .filter(Boolean);

  const stripped = raw.replace(/\([^)]*\)/g, ' ');
  const normalized = stripped.replace(/[+]/g, '-');
  const pieces = normalized
    .split('-')
    .flatMap((piece) => piece.split('/'))
    .map((piece) => piece.trim())
    .filter(Boolean);

  const badges = pieces
    .flatMap((piece) => piece.split(/\s+/))
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);

  return { badges, notes, raw };
};

const getBadgeClasses = (value: string) => {
  const token = value.toUpperCase();

  if (token.includes('BL')) {
    return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  }

  if (token.includes('BT')) {
    return 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200';
  }

  if (token.includes('BS')) {
    return 'border-rose-400/20 bg-rose-500/10 text-rose-200';
  }

  return 'border-amber-400/15 bg-amber-500/10 text-amber-200';
};

const IATA_PATTERN = /\b[A-Z]{3}\b/g;

const TransitNotePill: React.FC<{ note: string; language: 'it' | 'en' }> = ({ note, language }) => {
  const [activeIata, setActiveIata] = useState<string | null>(null);
  const [activeName, setActiveName] = useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeIata) {
      return;
    }

    const closePopup = () => {
      setActiveIata(null);
      setActiveName('');
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePopup();
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', closePopup, true);

    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', closePopup, true);
    };
  }, [activeIata]);

  const matches = Array.from(note.matchAll(IATA_PATTERN)) as RegExpMatchArray[];
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80">
        {note}
      </div>
    );
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const code = match[0];
    const start = match.index ?? 0;
    const end = start + code.length;

    if (start > lastIndex) {
      parts.push(<span key={`text-${index}`}>{note.slice(lastIndex, start)}</span>);
    }

    parts.push(
      <button
        key={`iata-${code}-${start}`}
        type="button"
        onClick={async (event) => {
          event.stopPropagation();
          if (activeIata === code) {
            setActiveIata(null);
            setActiveName('');
            return;
          }

          setActiveIata(code);
          setActiveName(getCommonIataCityName(code, language));
          const resolvedName = await getIataCityName(code, language);
          setActiveName(resolvedName || code);
        }}
        className="rounded px-1 font-black text-cyan-200 underline decoration-cyan-400/50 underline-offset-2 transition-all hover:bg-cyan-500/10"
      >
        {code}
      </button>
    );

    lastIndex = end;
  });

  if (lastIndex < note.length) {
    parts.push(<span key="tail">{note.slice(lastIndex)}</span>);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/80">
        {parts}
      </div>
      {activeIata && (
        <div className="absolute left-0 top-full z-20 mt-2 min-w-40 rounded-xl border border-white/10 bg-[#161616] px-3 py-2 shadow-2xl">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/35">{activeIata}</div>
          <div className="mt-1 text-sm font-semibold text-white">{activeName || activeIata}</div>
        </div>
      )}
    </div>
  );
};

export const FlightCardExpandedContent: React.FC<FlightCardExpandedContentProps> = ({
  flight,
  posType,
  t,
  language,
  confidence,
}) => (
  (() => {
    const parsedRequest = parseContainerRequest(flight.richiesta);
    const requestBadges = [...(flight.fc ? [flight.fc.toUpperCase()] : []), ...parsedRequest.badges];
    const uniqueBadges = Array.from(new Set(requestBadges));
    const hasOpsDetails = uniqueBadges.length > 0 || parsedRequest.notes.length > 0 || flight.tot || flight.anomaly || flight.bag;

    return (
      <>
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.01] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-white/30" />
            <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">{posType}</span>
          </div>
          <div className="text-[10px] text-white/30 font-bold uppercase tracking-widest">{flight.terminal}</div>
        </div>
        {hasOpsDetails && (
          <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[10px] text-white/30 uppercase tracking-widest font-bold">{t.baggageDetails}</span>
              {flight.tot && (
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-200">
                  TOT {flight.tot}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {uniqueBadges.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] text-white/35 font-bold uppercase tracking-widest">{t.locali}</div>
                  <div className="flex flex-wrap gap-2">
                    {uniqueBadges.map((badge) => (
                      <span
                        key={badge}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-black font-mono uppercase tracking-wide ${getBadgeClasses(badge)}`}
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {parsedRequest.notes.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] text-white/35 font-bold uppercase tracking-widest">{t.transiti}</div>
                  <div className="flex flex-wrap gap-2">
                    {parsedRequest.notes.map((note) => (
                      <TransitNotePill key={note} note={note} language={language} />
                    ))}
                  </div>
                </div>
              )}
              {(flight.anomaly || flight.bag) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {flight.anomaly && (
                    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/35">{t.anomaly}</div>
                      <div className="text-xs text-white/80">{flight.anomaly}</div>
                    </div>
                  )}
                  {flight.bag && (
                    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/35">{t.bag}</div>
                      <div className="text-xs text-white/80">{flight.bag}</div>
                    </div>
                  )}
                </div>
              )}
              {parsedRequest.raw && uniqueBadges.length === 0 && parsedRequest.notes.length === 0 && (
                <div>
                  <div className="mb-2 text-[10px] text-white/35 font-bold uppercase tracking-widest">{t.rawRequest}</div>
                  <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs font-mono text-white/80">
                    {parsedRequest.raw}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {typeof confidence === 'number' && (
          <div className="px-4 py-3 border-b border-white/5 text-xs text-white/65 flex items-center justify-between">
            <span className="uppercase tracking-[0.2em] text-white/35">{t.confidence}</span>
            <span className="font-black text-emerald-300">{Math.round(confidence * 100)}%</span>
          </div>
        )}
      </>
    );
  })()
);

interface FlightCardProps {
  flight: Flight;
  t: any;
  language: 'it' | 'en';
  isConnectedToNext?: boolean;
  isConnectedToPrev?: boolean;
  urgencyColor?: string;
  nextUrgencyColor?: string;
  focusIndex?: number;
}

export const FlightCard: React.FC<FlightCardProps> = ({ 
  flight, t, language, isConnectedToNext, isConnectedToPrev, 
  urgencyColor: propUrgencyColor, nextUrgencyColor, focusIndex
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const minutesToTarget = getMinutesToTarget(flight.std);
  const posType = getPositionType(flight.terminal, flight.position);
  
  const minutesToSTD = Math.floor((new Date(flight.std).getTime() - Date.now()) / 60000);
  const isFocused = minutesToSTD >= 30 && minutesToSTD <= 90;
  const urgencyColor = propUrgencyColor || getUrgencyColor(minutesToSTD);
  const stdCountdown = formatDuration(minutesToSTD);
  const [destinationName, setDestinationName] = useState(() => getCommonIataCityName(flight.destination, language));
  
  let statusLabel = `${minutesToTarget}m`;
  let labelClass = "text-white/40";

  if (minutesToSTD <= 0) {
    statusLabel = t.departed;
    labelClass = "bg-gray-600 text-white";
  } else if (minutesToSTD <= 40) {
    statusLabel = t.boarding;
    labelClass = "bg-red-600 text-white animate-pulse";
  } else if (minutesToSTD <= 60) {
    statusLabel = t.preparing;
    labelClass = "bg-amber-600 text-white";
  }

  useEffect(() => {
    let cancelled = false;
    const commonName = getCommonIataCityName(flight.destination, language);
    setDestinationName(commonName);

    if (commonName) {
      return () => {
        cancelled = true;
      };
    }

    getIataCityName(flight.destination, language).then((name) => {
      if (!cancelled) {
        setDestinationName(name);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [flight.destination, language]);

  return (
    <motion.div 
      layout
      className={`bg-[#1a1a1a] border ${isFocused ? 'border-white/40 shadow-[0_0_20px_rgba(255,255,255,0.08)] ring-1 ring-white/20' : 'border-white/5'} rounded-xl shadow-lg relative mb-4`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div 
        className="p-4 cursor-pointer flex items-center justify-between gap-4"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4 flex-1">
          <div className="relative">
            <div 
              className="w-16 h-16 rounded-lg flex flex-col items-center justify-center text-white font-bold shadow-lg relative z-20"
              style={{ backgroundColor: urgencyColor }}
            >
                                    <span className="text-lg leading-none">{flight.position}</span>
                                    <span className="text-[18px] font-black uppercase leading-none mt-1">{flight.destination}</span>
            </div>
            <AnimatePresence>
              {isConnectedToNext && !isExpanded && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.6 }}
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                  transition={{ delay: 0.5, duration: 0.5 }}
                  className="absolute top-full left-1/2 -translate-x-1/2 w-1.5 h-[72px] z-10"
                  style={{ 
                    background: `linear-gradient(to bottom, ${urgencyColor}, ${nextUrgencyColor || urgencyColor})`
                  }}
                />
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-[14px] truncate">{flight.flightNumber}</span>
            </div>
            
            {(flight.fc || flight.richiesta || flight.tot) && !isExpanded && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-0.5 text-[9px] leading-tight max-w-[140px] truncate whitespace-nowrap"
              >
                {flight.fc && <span className="text-white/70 font-black mr-1.5">{flight.fc}</span>}
                {flight.richiesta && <span className="text-white/60 font-medium italic mr-1.5">{flight.richiesta}</span>}
                {flight.tot && <span className="text-white/30 font-bold">{flight.tot}</span>}
              </motion.div>
            )}

            <div className="flex items-center gap-4 mt-1 text-[9px] text-white/50">
              <div className="flex items-center gap-1">
                <ClockIcon size={10} />
                <span>STD: {formatHHmm(flight.std)}</span>
              </div>
            </div>
            {destinationName && (
              <div className="mt-1 text-[8px] leading-tight text-white/30 uppercase tracking-[0.14em] truncate">
                {destinationName}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end justify-center gap-1 shrink-0">
          <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase mb-1 ${labelClass}`}>
            {statusLabel}
          </div>
          <div 
            className="text-[18px] font-black tracking-tighter font-mono leading-none" 
            style={{ color: urgencyColor }}
          >
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
              language={language}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
