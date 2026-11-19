import { useColorScheme } from 'react-native';

const light = {
  dark: false,
  bg: '#FFFFFF',
  sheet: 'rgba(248,248,250,0.98)',
  card: '#FFFFFF',
  field: 'rgba(118,118,128,0.12)',
  text: '#111114',
  sub: '#6C6C72',
  border: 'rgba(60,60,67,0.18)',
  accent: '#0A84FF',
  accentText: '#FFFFFF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  shadow: '#000',
};

const dark: typeof light = {
  dark: true,
  bg: '#000000',
  sheet: 'rgba(28,28,30,0.98)',
  card: '#2C2C2E',
  field: 'rgba(118,118,128,0.24)',
  text: '#F5F5F7',
  sub: '#9A9AA0',
  border: 'rgba(84,84,88,0.6)',
  accent: '#0A84FF',
  accentText: '#FFFFFF',
  green: '#30D158',
  orange: '#FF9F0A',
  red: '#FF453A',
  shadow: '#000',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const trafficColor = {
  NORMAL: '#0A84FF',
  SLOW: '#FF9500',
  TRAFFIC_JAM: '#E0262B',
} as const;
