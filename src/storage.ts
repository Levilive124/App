import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LatLng } from './utils/geo';

export type SavedPlace = {
  id: string;
  name: string;
  address: string;
  location: LatLng;
  kind?: 'home' | 'work' | 'favorite';
};

export type Settings = {
  mapType: 'standard' | 'satellite' | 'hybrid' | 'terrain';
  traffic: boolean;
  incidents: boolean;
  threeD: boolean;
  googleOnIos: boolean;
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
  voice: boolean;
};

export const defaultSettings: Settings = {
  mapType: 'standard',
  traffic: true,
  incidents: true,
  threeD: true,
  googleOnIos: false,
  avoidTolls: false,
  avoidHighways: false,
  avoidFerries: false,
  voice: true,
};

const KEYS = { favorites: 'karten.favorites', recents: 'karten.recents', settings: 'karten.settings' };

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const write = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {});

export const store = {
  favorites: () => read<SavedPlace[]>(KEYS.favorites, []),
  setFavorites: (v: SavedPlace[]) => write(KEYS.favorites, v),
  recents: () => read<SavedPlace[]>(KEYS.recents, []),
  setRecents: (v: SavedPlace[]) => write(KEYS.recents, v.slice(0, 15)),
  settings: async () => ({ ...defaultSettings, ...(await read<Partial<Settings>>(KEYS.settings, {})) }),
  setSettings: (v: Settings) => write(KEYS.settings, v),
};
