
export type TerminalType = 'T1' | 'T2';

export type PositionType = 'Scivolo' | 'Nastro' | 'Baia';

export interface Flight {
  id: string;
  flightNumber: string;
  destination: string;
  std: string; // ISO string or HH:mm
  terminal: TerminalType;
  position: string;
  tags: string[];
  fc?: string;
  richiesta?: string;
  tot?: string;
}

export interface OCRFlightCandidate extends Flight {
  sourceLine: string;
  confidence: number;
}

export interface OCRExtractionResult {
  flights: OCRFlightCandidate[];
  text: string;
}

export interface AppState {
  flights: Flight[];
  language: 'it' | 'en';
  showPast: boolean;
  filterType: PositionType | 'All';
  searchQuery: string;
  showFocusOnly: boolean;
  showMockFlights: boolean;
}
