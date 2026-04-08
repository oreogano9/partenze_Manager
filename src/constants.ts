
import { Flight, TerminalType, PositionType } from './types';

export type GlossaryEntry = {
  code: string;
  it: string;
  en: string;
};

export const getPositionType = (terminal: TerminalType, position: string): PositionType => {
  const posNum = parseInt(position, 10);

  if (!Number.isFinite(posNum)) {
    return 'Baia';
  }
  
  if (terminal === 'T1') {
    if (posNum === 39 || posNum === 46) return 'Carosello';
    if ((posNum >= 1 && posNum <= 11) || (posNum >= 40 && posNum <= 48)) return 'Scivolo';
    return 'Baia';
  } else {
    // T3
    const t3Scivoli = [14, 16, 18, 20, 22, 24, 26, 28, 32, 34, 36, 38, 40, 42]; // Even 14-42 excl 30
    if (t3Scivoli.includes(posNum)) return 'Scivolo';
    if ([6, 8, 10, 12].includes(posNum)) return 'Carosello';
    return 'Baia';
  }
};

export const getPrinterTags = (flight: Pick<Flight, 'terminal' | 'position'>): string[] => {
  if (flight.terminal !== 'T1') {
    return [];
  }

  const positionType = getPositionType(flight.terminal, flight.position);

  if (positionType === 'Scivolo') {
    return ['AS06'];
  }

  if (positionType === 'Carosello') {
    return ['AS02'];
  }

  return ['AS02', 'APH'];
};

export const requiresContainerDamageCheck = (flight: Pick<Flight, 'flightNumber'>) => {
  const normalizedFlightNumber = flight.flightNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ['LH', 'LX', 'OS'].some((prefix) => normalizedFlightNumber.startsWith(prefix));
};

export const requiresEmptyCartNote = (flight: Pick<Flight, 'flightNumber'>) => {
  const normalizedFlightNumber = flight.flightNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalizedFlightNumber.startsWith('IB');
};

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  { code: 'BL', it: 'Colli / bagagli locali.', en: 'Local baggage / local load.' },
  { code: 'BT', it: 'Transito.', en: 'Transit.' },
  { code: 'BS', it: 'Short connection.', en: 'Short connection.' },
  { code: 'TF', it: 'Short connection.', en: 'Short connection.' },
  { code: 'FC', it: 'First Class / bagagli priority.', en: 'First Class / priority baggage.' },
  { code: 'CARR', it: 'Nel campo FC significa priority su carrello dedicato.', en: 'In the FC field it means priority on a dedicated cart.' },
  { code: 'AKH', it: 'Totale contenitori AKH.', en: 'Total AKH containers.' },
  { code: 'AS02', it: 'Stampante T1 per caroselli e baie.', en: 'T1 printer for belts and bays.' },
  { code: 'AS06', it: 'Stampante T1 per scivoli.', en: 'T1 printer for slides.' },
  { code: 'APH', it: 'Stampante T1 solo per baie.', en: 'T1 printer for bays only.' },
];

export const TRANSLATIONS = {
  it: {
    appTitle: 'Partenze Manager',
    terminal: 'Terminal',
    position: 'Posizione',
    std: 'STD',
    target: 'Target',
    status: 'Stato',
    showPast: 'Decollati Visibili',
    hidePast: 'Decollati Nascosti',
    focusLabel: 'FOCUS',
    settings: 'Impostazioni',
    languageSettings: 'Lingua',
    glossary: 'Glossario',
    glossaryDescription: 'Cerca sigle operative e stampanti usate nell\'app.',
    glossarySearchPlaceholder: 'Cerca sigla o significato...',
    glossaryNoResults: 'Nessun risultato per questa ricerca.',
    debug: 'Debug',
    backToBoard: 'Torna alla board',
    debugDescription: 'Strumenti e toggle non essenziali per l\'uso quotidiano.',
    languageDescription: 'Scegli la lingua dell\'interfaccia.',
    clearLocalData: 'Cancella dati locali',
    clearLocalDataDescription: 'Rimuove voli importati e preferenze salvate da questo browser.',
    clearLocalDataAction: 'Cancella',
    italian: 'Italiano',
    english: 'Inglese',
    all: 'TUTTI',
    scivoli: 'SCIVOLI',
    caroselli: 'CAROSELLI',
    baie: 'BAIE',
    shift: 'Turno',
    shiftStart: 'Inizio',
    shiftEnd: 'Fine',
    clearShift: 'Disattiva',
    enableShift: 'Attiva',
    shiftDisabled: 'disattivato',
    done: 'Chiudi',
    noFlightsScheduled: 'Nessun volo previsto',
    emptyStateHint: 'Per iniziare, scansiona o importa una foto del foglio partenze.',
    noFlightsVisible: 'Nessun volo visibile',
    noFlightsVisibleHint: 'I voli importati esistono, ma i filtri attuali li stanno nascondendo.',
    emptyStateAction: 'Scansiona o importa foto',
    cameraMode: 'Fotocamera',
    importPhoto: 'Importa foto',
    export: 'Esporta',
    flights: 'voli',
    downloadBulkImport: 'Scarica file per importazione multipla',
    mobileIcsHint: 'Su mobile: scarica il file ICS e aprilo per aggiungere tutti i voli al calendario di sistema.',
    copyForAi: 'Copia',
    copyEventText: 'Copia testo eventi per i voli visibili',
    copiedEventText: 'Testo eventi copiato.',
    clipboardCopyFailed: 'Copia negli appunti non riuscita.',
    noCalendarChangesToExport: 'Nessun volo nuovo o aggiornato da esportare.',
    scanSheet: 'Scansiona',
    scanningProgress: 'Scansione',
    scanTerminalLabel: 'Terminale scansione',
    ocrReview: 'Dati estratti dalla foto',
    ocrFlightsTab: 'Voli',
    ocrPhotoTab: 'Foto',
    addImage: 'Aggiungi immagine',
    imagesScanned: 'immagini scansionate',
    latestImage: 'Ultima immagine',
    uploadedFlightSheet: 'Foglio voli caricato',
    rawOcrText: 'Testo letto dalla foto',
    crossedOutLinesDetected: 'Righe barrate rilevate',
    noOcrTextRecognized: 'Nessun testo riconosciuto da questa immagine.',
    parsedFlights: 'Voli estratti',
    parsedFlightsHint: 'Filtra o deseleziona tutto quello che non vuoi aggiungere.',
    onlyScivoli: 'Solo Scivoli',
    onlyCaroselli: 'Solo Caroselli',
    onlyBaie: 'Solo Baie',
    none: 'Nessuno',
    noCompleteFlightsParsed: 'Nessun volo completo estratto. Prova un\'immagine più dritta con le righe complete visibili.',
    noFlightsMatchTypeFilter: 'Nessun volo estratto corrisponde a questo filtro.',
    selected: 'Selezionati',
    cancel: 'Annulla',
    add: 'Aggiungi',
    skip: 'Salta',
    addThisFlight: 'Aggiungi questo volo',
    fixBeforeImport: 'Completa i campi prima di aggiungere',
    fixBeforeImportHint: 'Questo volo ha dati mancanti. Correggi il campo evidenziato oppure saltalo.',
    newFlight: 'Nuovo',
    updatesExisting: 'Aggiorna esistente',
    alreadyPresent: 'Già presente',
    beforeAfter: 'Prima/Dopo',
    beforeAfterDetails: 'Modifiche rilevate',
    crossedOut: 'Barrato',
    requiredFields: 'Campi necessari',
    requiredFieldsMissing: 'Completa i campi',
    completeRequiredFieldsHint: 'Completa i campi necessari nei voli selezionati prima di aggiungerli.',
    flightNumberLabel: 'Volo',
    destinationLabel: 'Destinazione',
    positionLabel: 'Baia / Carosello',
    baggageDetails: 'Dettagli bagagli',
    locali: 'Locali',
    transiti: 'Transiti',
    containersNeeded: 'Contenitori richiesti',
    specialNotes: 'Note speciali',
    anomaly: 'Anomalia',
    bag: 'Bag',
    rawRequest: 'Richiesta grezza',
    confidence: 'Affidabilità',
    copied: 'Copiato',
    retry: 'Riprova',
    copy: 'Copia',
    smistato: 'Smistato',
    impilato: 'Impilato',
    sottoBordo: 'Sotto Bordo',
    tagMissing: 'TAG?',
    rush: 'Rush',
    priority: 'Priorità',
    critical: 'CRITICO',
    preparing: 'In chiusura',
    boarding: 'In uscita',
    departed: 'Decollato',
    language: 'Lingua'
  },
  en: {
    appTitle: 'Partenze Manager',
    terminal: 'Terminal',
    position: 'Position',
    std: 'STD',
    target: 'Target',
    status: 'Status',
    showPast: 'Departed Visible',
    hidePast: 'Departed Hidden',
    focusLabel: 'FOCUS',
    settings: 'Settings',
    languageSettings: 'Language',
    glossary: 'Glossary',
    glossaryDescription: 'Search operating codes and printers used in the app.',
    glossarySearchPlaceholder: 'Search code or meaning...',
    glossaryNoResults: 'No results for this search.',
    debug: 'Debug',
    backToBoard: 'Back to board',
    debugDescription: 'Non-essential tools and toggles for day-to-day use.',
    languageDescription: 'Choose the app interface language.',
    clearLocalData: 'Clear local data',
    clearLocalDataDescription: 'Removes imported flights and saved preferences from this browser.',
    clearLocalDataAction: 'Clear',
    italian: 'Italian',
    english: 'English',
    all: 'ALL',
    scivoli: 'SLIDES',
    caroselli: 'BELTS',
    baie: 'BAYS',
    shift: 'Shift',
    shiftStart: 'Start',
    shiftEnd: 'End',
    clearShift: 'Disable',
    enableShift: 'Enable',
    shiftDisabled: 'off',
    done: 'Done',
    noFlightsScheduled: 'No flights scheduled',
    emptyStateHint: 'To get started, scan or import a photo of the departures sheet.',
    noFlightsVisible: 'No visible flights',
    noFlightsVisibleHint: 'Imported flights exist, but the current filters are hiding them.',
    emptyStateAction: 'Scan or import photo',
    cameraMode: 'Camera',
    importPhoto: 'Import photo',
    export: 'Export',
    flights: 'flights',
    downloadBulkImport: 'Download file for bulk import',
    mobileIcsHint: 'On mobile: download the ICS file and open it to add all flights to your system calendar.',
    copyForAi: 'Copy',
    copyEventText: 'Copy event text for visible flights',
    copiedEventText: 'Copied event text.',
    clipboardCopyFailed: 'Clipboard copy failed.',
    noCalendarChangesToExport: 'No new or updated flights to export.',
    scanSheet: 'Scan Sheet',
    scanningProgress: 'Scanning',
    scanTerminalLabel: 'Scan terminal',
    ocrReview: 'OCR Review',
    ocrFlightsTab: 'Flights',
    ocrPhotoTab: 'Photo',
    addImage: 'Add image',
    imagesScanned: 'images scanned',
    latestImage: 'Latest image',
    uploadedFlightSheet: 'Uploaded flight sheet',
    rawOcrText: 'Raw OCR Text',
    crossedOutLinesDetected: 'Crossed-out lines detected',
    noOcrTextRecognized: 'No text was recognized from this image.',
    parsedFlights: 'Parsed Flights',
    parsedFlightsHint: 'Filter or uncheck anything you do not want to add.',
    onlyScivoli: 'Only Scivoli',
    onlyCaroselli: 'Only Belts',
    onlyBaie: 'Only Bays',
    none: 'None',
    noCompleteFlightsParsed: 'No complete flights were parsed. Try a straighter image with full rows visible.',
    noFlightsMatchTypeFilter: 'No parsed flights match this type filter.',
    selected: 'Selected',
    cancel: 'Cancel',
    add: 'Add',
    skip: 'Skip',
    addThisFlight: 'Add this flight',
    fixBeforeImport: 'Complete fields before adding',
    fixBeforeImportHint: 'This flight is missing required data. Fix the highlighted field or skip it.',
    newFlight: 'New',
    updatesExisting: 'Updates existing',
    alreadyPresent: 'Already present',
    beforeAfter: 'Before/After',
    beforeAfterDetails: 'Detected changes',
    crossedOut: 'Crossed out',
    requiredFields: 'Required fields',
    requiredFieldsMissing: 'Complete fields',
    completeRequiredFieldsHint: 'Complete the required fields in the selected flights before adding them.',
    flightNumberLabel: 'Flight',
    destinationLabel: 'Destination',
    positionLabel: 'Bay / Belt',
    baggageDetails: 'Baggage Details',
    locali: 'Local',
    transiti: 'Transit',
    containersNeeded: 'Containers needed',
    specialNotes: 'Special notes',
    anomaly: 'Anomaly',
    bag: 'Bag',
    rawRequest: 'Raw request',
    confidence: 'Confidence',
    copied: 'Copied',
    retry: 'Retry',
    copy: 'Copy',
    smistato: 'Sorted',
    impilato: 'Stacked',
    sottoBordo: 'Under Wing',
    tagMissing: 'TAG?',
    rush: 'Rush',
    priority: 'Priority',
    critical: 'CRITICAL',
    preparing: 'Preparing',
    boarding: 'Boarding',
    departed: 'Departed',
    language: 'Language'
  }
};
