
export type TerminalType = 'T1' | 'T3';

export type PositionType = 'Scivolo' | 'Carosello' | 'Baia';

export interface Flight {
  id: string;
  importedAt?: string;
  carrier?: string;
  flightNumberNumeric?: string;
  flightNumber: string;
  destination: string;
  std: string; // ISO string or HH:mm
  terminal: TerminalType;
  position: string;
  tags: string[];
  fc?: string;
  richiesta?: string;
  tot?: string;
  anomaly?: string;
  bag?: string;
}

export interface OCRFlightCandidate extends Flight {
  sourceLine: string;
  confidence: number;
  crossedOut?: boolean;
}

export interface OCRExtractionResult {
  flights: OCRFlightCandidate[];
  text: string;
}

export interface AppState {
  flights: Flight[];
  language: 'it' | 'en';
  showPast: boolean;
  filterTypes: PositionType[];
  searchQuery: string;
  showFocusOnly: boolean;
  showMockFlights: boolean;
}
