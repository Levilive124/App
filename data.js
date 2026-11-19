// Einsatzzentrale – game data (original content)

/** Vehicle types. `fills` = which requirement slots this vehicle can cover. */
export const VEHICLES = {
  LF:    { name: 'Löschfahrzeug',        short: 'LF',    org: 'fire',   cost: 5000,  level: 1, fills: ['LF'],        color: '#e5322d' },
  TLF:   { name: 'Tanklöschfahrzeug',    short: 'TLF',   org: 'fire',   cost: 6500,  level: 2, fills: ['TLF', 'LF'], color: '#e5322d' },
  DLK:   { name: 'Drehleiter',           short: 'DLK',   org: 'fire',   cost: 11000, level: 3, fills: ['DLK'],       color: '#e5322d' },
  RW:    { name: 'Rüstwagen',            short: 'RW',    org: 'fire',   cost: 12000, level: 4, fills: ['RW'],        color: '#e5322d' },
  ELW:   { name: 'Einsatzleitwagen',     short: 'ELW',   org: 'fire',   cost: 9000,  level: 5, fills: ['ELW'],       color: '#e5322d' },
  GWG:   { name: 'Gerätewagen Gefahrgut', short: 'GW-G', org: 'fire',   cost: 15000, level: 7, fills: ['GWG'],       color: '#e5322d' },
  RTW:   { name: 'Rettungswagen',        short: 'RTW',   org: 'ems',    cost: 4500,  level: 1, fills: ['RTW'],       color: '#f2a20c' },
  NEF:   { name: 'Notarzteinsatzfahrzeug', short: 'NEF', org: 'ems',    cost: 4000,  level: 2, fills: ['NEF'],       color: '#f2a20c' },
  KTW:   { name: 'Krankentransportwagen', short: 'KTW',  org: 'ems',    cost: 3000,  level: 3, fills: ['KTW'],       color: '#f2a20c' },
  FUSTW: { name: 'Funkstreifenwagen',    short: 'FuStW', org: 'police', cost: 3500,  level: 1, fills: ['FUSTW'],     color: '#1f8a4c' },
  HGRU:  { name: 'Gruppenkraftwagen',    short: 'GruKw', org: 'police', cost: 8000,  level: 6, fills: ['HGRU'],      color: '#1f8a4c' },
};

/** Building types. `starter` = vehicle that comes with the building. */
export const BUILDINGS = {
  FW:  { name: 'Feuerwache',     icon: 'local_fire_department', color: '#e5322d', cost: 10000, level: 1, starter: 'LF',    vehicles: ['LF', 'TLF', 'DLK', 'RW', 'ELW', 'GWG'], slots: 8 },
  RW:  { name: 'Rettungswache',  icon: 'emergency',             color: '#f2a20c', cost: 7000,  level: 1, starter: 'RTW',   vehicles: ['RTW', 'NEF', 'KTW'], slots: 6 },
  POL: { name: 'Polizeiwache',   icon: 'local_police',          color: '#1f8a4c', cost: 7000,  level: 1, starter: 'FUSTW', vehicles: ['FUSTW', 'HGRU'], slots: 6 },
  KH:  { name: 'Krankenhaus',    icon: 'local_hospital',        color: '#2f6fe4', cost: 20000, level: 2, starter: null,    vehicles: [], slots: 0 },
};

/**
 * Missions. req = required vehicles; pat = [min,max] patients; work = on-scene seconds (game time);
 * reward = credits; lvl = minimum player level.
 */
export const MISSIONS = [
  // Feuerwehr
  { id: 'container', name: 'Brennender Müllcontainer', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 90, reward: 420, text: 'Anrufer meldet Rauch und Flammen aus einem Container im Hinterhof.' },
  { id: 'hecke', name: 'Brennende Hecke', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 75, reward: 380, text: 'Beim Unkrautabflämmen ist eine Hecke in Brand geraten.' },
  { id: 'pkwbrand', name: 'PKW-Brand', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 110, reward: 520, text: 'Ein abgestelltes Auto qualmt stark aus dem Motorraum.' },
  { id: 'oelspur', name: 'Ölspur auf der Fahrbahn', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 140, reward: 450, text: 'Mehrere hundert Meter Ölspur, Rutschgefahr für Zweiräder.' },
  { id: 'baum', name: 'Baum auf Straße', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 160, reward: 560, text: 'Nach starkem Wind blockiert ein umgestürzter Baum die Fahrbahn.' },
  { id: 'rauchmelder', name: 'Piepender Rauchmelder', cat: 'fire', lvl: 1, req: { LF: 1 }, work: 70, reward: 360, text: 'Nachbarn hören seit einer Stunde einen Rauchmelder, niemand öffnet.' },
  { id: 'tuer', name: 'Tür öffnen – Person hilflos', cat: 'fire', lvl: 1, req: { LF: 1, RTW: 1 }, pat: [1, 1], work: 100, reward: 780, text: 'Ältere Dame ruft um Hilfe, Wohnungstür ist verschlossen.' },
  { id: 'kuechenbrand', name: 'Küchenbrand', cat: 'fire', lvl: 2, req: { LF: 2, RTW: 1 }, pat: [0, 1], work: 160, reward: 1250, text: 'Fettbrand in einer Küche im 2. OG, Rauch im Treppenhaus.' },
  { id: 'kellerbrand', name: 'Kellerbrand', cat: 'fire', lvl: 2, req: { LF: 2, TLF: 1 }, work: 200, reward: 1400, text: 'Dichter Rauch dringt aus den Kellerfenstern eines Mehrfamilienhauses.' },
  { id: 'wohnungsbrand', name: 'Wohnungsbrand mit Menschenrettung', cat: 'fire', lvl: 3, req: { LF: 2, DLK: 1, RTW: 2, NEF: 1, FUSTW: 1 }, pat: [1, 3], work: 260, reward: 3200, text: 'Flammen schlagen aus einem Fenster im 3. OG, Person am Fenster sichtbar.' },
  { id: 'dachstuhl', name: 'Dachstuhlbrand', cat: 'fire', lvl: 4, req: { LF: 3, DLK: 1, TLF: 1, ELW: 1 }, work: 360, reward: 4200, text: 'Ein Dachstuhl steht in Vollbrand, Gefahr des Übergreifens.' },
  { id: 'lagerhalle', name: 'Großbrand Lagerhalle', cat: 'fire', lvl: 6, req: { LF: 4, TLF: 2, DLK: 1, ELW: 1, RTW: 1, FUSTW: 2 }, pat: [0, 2], work: 480, reward: 7800, text: 'Eine Lagerhalle brennt, schwarze Rauchsäule kilometerweit sichtbar.' },
  { id: 'gefahrgut', name: 'Austritt unbekannter Flüssigkeit', cat: 'fire', lvl: 7, req: { LF: 2, GWG: 1, ELW: 1, RTW: 1, FUSTW: 1 }, pat: [0, 2], work: 420, reward: 6400, text: 'Aus einem Fass auf einem Firmengelände tritt eine stechend riechende Flüssigkeit aus.' },
  { id: 'gasgeruch', name: 'Gasgeruch im Gebäude', cat: 'fire', lvl: 2, req: { LF: 2, FUSTW: 1 }, work: 150, reward: 1100, text: 'Starker Gasgeruch im Hausflur, Bewohner sind unruhig.' },
  // Technische Hilfe / Verkehr
  { id: 'vu', name: 'Verkehrsunfall mit Verletzten', cat: 'fire', lvl: 1, req: { LF: 1, RTW: 1, FUSTW: 1 }, pat: [1, 2], work: 170, reward: 1350, text: 'Zwei Autos sind an einer Kreuzung zusammengestoßen.' },
  { id: 'vueingeklemmt', name: 'Verkehrsunfall – Person eingeklemmt', cat: 'fire', lvl: 4, req: { LF: 2, RW: 1, RTW: 1, NEF: 1, FUSTW: 1 }, pat: [1, 2], work: 300, reward: 3600, text: 'Fahrer nach Unfall im Fahrzeug eingeklemmt, ansprechbar.' },
  { id: 'aufzug', name: 'Person im Aufzug', cat: 'fire', lvl: 2, req: { LF: 1 }, work: 90, reward: 520, text: 'Aufzug zwischen zwei Etagen steckengeblieben, eine Person eingeschlossen.' },
  // Rettungsdienst
  { id: 'sturz', name: 'Gestürzte Person', cat: 'ems', lvl: 1, req: { RTW: 1 }, pat: [1, 1], work: 80, reward: 420, text: 'Mann ist auf dem Gehweg gestürzt und klagt über Schmerzen in der Hüfte.' },
  { id: 'atemnot', name: 'Atemnot', cat: 'ems', lvl: 1, req: { RTW: 1 }, pat: [1, 1], work: 90, reward: 460, text: 'Frau bekommt schlecht Luft und kann kaum sprechen.' },
  { id: 'kreislauf', name: 'Kreislaufprobleme', cat: 'ems', lvl: 1, req: { RTW: 1 }, pat: [1, 1], work: 70, reward: 380, text: 'Person ist im Supermarkt kurz zusammengesackt.' },
  { id: 'bewusstlos', name: 'Bewusstlose Person', cat: 'ems', lvl: 2, req: { RTW: 1, NEF: 1 }, pat: [1, 1], work: 120, reward: 900, text: 'Person liegt regungslos an einer Bushaltestelle.' },
  { id: 'herz', name: 'Verdacht auf Herzinfarkt', cat: 'ems', lvl: 2, req: { RTW: 1, NEF: 1 }, pat: [1, 1], work: 130, reward: 980, text: 'Starke Brustschmerzen, Ausstrahlung in den linken Arm.' },
  { id: 'reanimation', name: 'Reanimation', cat: 'ems', lvl: 3, req: { RTW: 1, NEF: 1, LF: 1 }, pat: [1, 1], work: 200, reward: 1700, text: 'Angehörige haben mit der Herzdruckmassage begonnen.' },
  { id: 'verlegung', name: 'Krankentransport', cat: 'ems', lvl: 3, req: { KTW: 1 }, pat: [1, 1], work: 60, reward: 420, text: 'Patient soll von zuhause zur Untersuchung gebracht werden.' },
  { id: 'kindernotfall', name: 'Kindernotfall', cat: 'ems', lvl: 2, req: { RTW: 1, NEF: 1 }, pat: [1, 1], work: 110, reward: 950, text: 'Kleinkind hat hohes Fieber und krampft.' },
  // Polizei
  { id: 'diebstahl', name: 'Ladendiebstahl', cat: 'police', lvl: 1, req: { FUSTW: 1 }, work: 100, reward: 340, text: 'Detektiv hält einen Ladendieb im Büro fest.' },
  { id: 'ruhestoerung', name: 'Ruhestörung', cat: 'police', lvl: 1, req: { FUSTW: 1 }, work: 70, reward: 280, text: 'Laute Musik aus einer Wohnung, Nachbarn beschweren sich.' },
  { id: 'falschparker', name: 'Zugeparkte Einfahrt', cat: 'police', lvl: 1, req: { FUSTW: 1 }, work: 60, reward: 240, text: 'Ein Auto blockiert seit Stunden eine Garageneinfahrt.' },
  { id: 'einbruch', name: 'Einbruch in Wohnung', cat: 'police', lvl: 2, req: { FUSTW: 2 }, work: 160, reward: 900, text: 'Bewohner kommen aus dem Urlaub, die Tür ist aufgebrochen.' },
  { id: 'schlaegerei', name: 'Schlägerei', cat: 'police', lvl: 2, req: { FUSTW: 2, RTW: 1 }, pat: [1, 2], work: 150, reward: 1250, text: 'Mehrere Personen prügeln sich vor einer Gaststätte.' },
  { id: 'vermisst', name: 'Vermisste Person', cat: 'police', lvl: 3, req: { FUSTW: 3 }, work: 260, reward: 1500, text: 'Ein demenzkranker Mann ist aus dem Pflegeheim verschwunden.' },
  { id: 'demo', name: 'Unangemeldete Versammlung', cat: 'police', lvl: 6, req: { FUSTW: 3, HGRU: 2 }, work: 360, reward: 3800, text: 'Spontane Kundgebung mit etwa 200 Personen blockiert eine Kreuzung.' },
  { id: 'unfallflucht', name: 'Unfallflucht', cat: 'police', lvl: 1, req: { FUSTW: 1 }, work: 90, reward: 330, text: 'Geparktes Auto wurde angefahren, Verursacher ist weg.' },
];

export const STATUS = {
  1: { label: 'Frei über Funk', color: '#2bb673' },
  2: { label: 'Auf Wache', color: '#5aa9ff' },
  3: { label: 'Anfahrt', color: '#f2a20c' },
  4: { label: 'Am Einsatzort', color: '#e5322d' },
  7: { label: 'Patiententransport', color: '#ff7a00' },
  8: { label: 'Am Krankenhaus', color: '#9b6bff' },
};

export const CAT = {
  fire: { label: 'Feuerwehr', color: '#e5322d', icon: 'local_fire_department' },
  ems: { label: 'Rettungsdienst', color: '#f2a20c', icon: 'emergency' },
  police: { label: 'Polizei', color: '#1f8a4c', icon: 'local_police' },
};

/** XP needed to reach a level. */
export const xpForLevel = (lvl) => Math.round(250 * (lvl - 1) ** 1.6);
