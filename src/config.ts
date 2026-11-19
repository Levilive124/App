import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleApiKey?: string;
  iosGoogleMaps?: boolean;
  bundleId?: string;
  androidCertSha1?: string;
};

export const GOOGLE_API_KEY: string = extra.googleApiKey || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
export const IOS_GOOGLE_MAPS_AVAILABLE = !!extra.iosGoogleMaps;
export const LANGUAGE = 'de';
export const REGION = 'DE';

/** Headers that let an app-restricted key work with the Google web-service APIs. */
export function appRestrictionHeaders(): Record<string, string> {
  const id = extra.bundleId ?? '';
  if (Platform.OS === 'ios' && id) return { 'X-Ios-Bundle-Identifier': id };
  if (Platform.OS === 'android' && id) {
    const h: Record<string, string> = { 'X-Android-Package': id };
    if (extra.androidCertSha1) h['X-Android-Cert'] = extra.androidCertSha1.replace(/:/g, '');
    return h;
  }
  return {};
}
