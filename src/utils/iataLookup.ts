type AirportEntry = {
  iata: string;
  city?: string;
  city_it?: string;
};

const COMMON_FCO_AIRPORTS: AirportEntry[] = [
  { iata: 'MAD', city: 'Madrid', city_it: 'Madrid' },
  { iata: 'BCN', city: 'Barcelona', city_it: 'Barcelona' },
  { iata: 'CTA', city: 'Catania', city_it: 'Catania' },
  { iata: 'PMO', city: 'Palermo', city_it: 'Palermo' },
  { iata: 'CDG', city: 'Paris, Charles de Gaulle', city_it: 'Parigi, Charles de Gaulle' },
  { iata: 'ORY', city: 'Paris, Orly', city_it: 'Parigi, Orly' },
  { iata: 'ATH', city: 'Athens', city_it: 'Atene' },
  { iata: 'LHR', city: 'London, Heathrow', city_it: 'Londra, Heathrow' },
  { iata: 'FRA', city: 'Frankfurt', city_it: 'Francoforte' },
  { iata: 'BRU', city: 'Brussels', city_it: 'Bruxelles' },
  { iata: 'MUC', city: 'Munich', city_it: 'Monaco di Baviera' },
  { iata: 'BRI', city: 'Bari', city_it: 'Bari' },
  { iata: 'NAP', city: 'Naples', city_it: 'Napoli' },
  { iata: 'LIN', city: 'Milan, Linate', city_it: 'Milano, Linate' },
  { iata: 'TRN', city: 'Turin', city_it: 'Torino' },
  { iata: 'BLQ', city: 'Bologna', city_it: 'Bologna' },
  { iata: 'FLR', city: 'Florence', city_it: 'Firenze' },
  { iata: 'GOA', city: 'Genoa', city_it: 'Genova' },
  { iata: 'TRS', city: 'Trieste', city_it: 'Trieste' },
  { iata: 'VRN', city: 'Verona', city_it: 'Verona' },
  { iata: 'VIE', city: 'Vienna', city_it: 'Vienna' },
  { iata: 'ZRH', city: 'Zurich', city_it: 'Zurigo' },
  { iata: 'DUB', city: 'Dublin', city_it: 'Dublino' },
  { iata: 'LIS', city: 'Lisbon', city_it: 'Lisbona' },
  { iata: 'AMS', city: 'Amsterdam', city_it: 'Amsterdam' },
  { iata: 'TLV', city: 'Tel Aviv Yafo, Tel Aviv', city_it: 'Tel Aviv Yafo, Tel Aviv' },
  { iata: 'JFK', city: 'New York, John F. Kennedy', city_it: 'New York, John F. Kennedy' },
];

const commonAirportMap = new Map(
  COMMON_FCO_AIRPORTS.map((entry) => [entry.iata.toUpperCase(), entry])
);

let fullAirportMapPromise: Promise<Map<string, AirportEntry>> | null = null;

const toCityName = (entry: AirportEntry | undefined, language: 'it' | 'en') => {
  if (!entry) {
    return '';
  }

  if (language === 'it') {
    return entry.city_it?.trim() || entry.city?.trim() || '';
  }

  return entry.city?.trim() || entry.city_it?.trim() || '';
};

export const getCommonIataCityName = (iata: string, language: 'it' | 'en') =>
  toCityName(commonAirportMap.get(iata.trim().toUpperCase()), language);

const loadFullAirportMap = async () => {
  if (!fullAirportMapPromise) {
    fullAirportMapPromise = import('../IATA.json').then((module) => {
      const airports = module.default as AirportEntry[];
      return new Map(airports.map((entry) => [entry.iata.toUpperCase(), entry]));
    });
  }

  return fullAirportMapPromise;
};

export const getIataCityName = async (iata: string, language: 'it' | 'en') => {
  const code = iata.trim().toUpperCase();
  const commonName = toCityName(commonAirportMap.get(code), language);
  if (commonName) {
    return commonName;
  }

  const fullAirportMap = await loadFullAirportMap();
  return toCityName(fullAirportMap.get(code), language);
};
