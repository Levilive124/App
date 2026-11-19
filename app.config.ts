import type { ExpoConfig } from 'expo/config';

// Google Maps Platform key (Maps SDK, Places API (New), Routes API, Geocoding API).
// Set it in a local `.env` file:  GOOGLE_MAPS_API_KEY=AIza...
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// On iOS the app uses Apple Maps (MapKit) as map renderer by default.
// Set IOS_GOOGLE_MAPS=1 to bundle the Google Maps SDK on iOS as well.
const IOS_GOOGLE = process.env.IOS_GOOGLE_MAPS === '1';

const BUNDLE_ID = 'com.levilive.karten';

const config: ExpoConfig = {
  name: 'Karten',
  slug: 'karten',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
  },
  plugins: [
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: GOOGLE_KEY || undefined,
        iosGoogleMapsApiKey: IOS_GOOGLE && GOOGLE_KEY ? GOOGLE_KEY : undefined,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Karten verwendet deinen Standort, um dich auf der Karte anzuzeigen und dich zu navigieren.',
      },
    ],
  ],
  extra: {
    googleApiKey: GOOGLE_KEY,
    iosGoogleMaps: IOS_GOOGLE && !!GOOGLE_KEY,
    bundleId: BUNDLE_ID,
    // Optional: SHA-1 of the Android signing cert, needed if the key is restricted to Android apps.
    androidCertSha1: process.env.ANDROID_CERT_SHA1 ?? '',
  },
};

export default config;
