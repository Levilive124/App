import { GOOGLE_API_KEY, LANGUAGE, REGION, appRestrictionHeaders } from '../config';
import type { LatLng } from '../utils/geo';
import { decodePolyline } from '../utils/polyline';
import { parseSeconds } from '../utils/format';

export class ApiError extends Error {}

async function request<T>(url: string, init: RequestInit & { fieldMask?: string } = {}): Promise<T> {
  if (!GOOGLE_API_KEY) throw new ApiError('Kein Google API-Schlüssel konfiguriert (GOOGLE_MAPS_API_KEY in .env).');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_API_KEY,
    ...appRestrictionHeaders(),
  };
  if (init.fieldMask) headers['X-Goog-FieldMask'] = init.fieldMask;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as object) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg);
  }
  return body as T;
}

const toGoogle = (p: LatLng) => ({ latitude: p.latitude, longitude: p.longitude });

/* ------------------------------------------------------------------ Places */

export type Suggestion = {
  placeId?: string;
  query?: string;
  title: string;
  subtitle: string;
  distanceMeters?: number;
};

export async function autocomplete(input: string, near: LatLng | null, sessionToken: string): Promise<Suggestion[]> {
  const body: any = { input, languageCode: LANGUAGE, regionCode: REGION, sessionToken, includeQueryPredictions: true };
  if (near) {
    body.locationBias = { circle: { center: toGoogle(near), radius: 30000 } };
    body.origin = toGoogle(near);
  }
  const res = await request<any>('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return (res.suggestions ?? []).map((s: any): Suggestion => {
    if (s.placePrediction) {
      const p = s.placePrediction;
      return {
        placeId: p.placeId,
        title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        subtitle: p.structuredFormat?.secondaryText?.text ?? '',
        distanceMeters: p.distanceMeters,
      };
    }
    const q = s.queryPrediction;
    return { query: q.text?.text, title: q.text?.text ?? '', subtitle: 'In der Nähe suchen' };
  });
}

export type Place = {
  id: string;
  name: string;
  address: string;
  location: LatLng;
  category?: string;
  rating?: number;
  ratingCount?: number;
  phone?: string;
  website?: string;
  openNow?: boolean;
  hours?: string[];
  photo?: string;
  priceLevel?: string;
};

const PLACE_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'location', 'primaryTypeDisplayName', 'rating', 'userRatingCount',
  'nationalPhoneNumber', 'websiteUri', 'currentOpeningHours.openNow', 'regularOpeningHours.weekdayDescriptions',
  'photos', 'priceLevel',
];

function mapPlace(p: any): Place {
  return {
    id: p.id,
    name: p.displayName?.text ?? 'Unbekannter Ort',
    address: p.formattedAddress ?? '',
    location: { latitude: p.location?.latitude, longitude: p.location?.longitude },
    category: p.primaryTypeDisplayName?.text,
    rating: p.rating,
    ratingCount: p.userRatingCount,
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    openNow: p.currentOpeningHours?.openNow,
    hours: p.regularOpeningHours?.weekdayDescriptions,
    photo: p.photos?.[0]?.name ? photoUrl(p.photos[0].name) : undefined,
    priceLevel: p.priceLevel,
  };
}

export function photoUrl(name: string, maxWidth = 800) {
  return `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidth}&key=${GOOGLE_API_KEY}`;
}

export async function placeDetails(placeId: string, sessionToken?: string): Promise<Place> {
  const qs = new URLSearchParams({ languageCode: LANGUAGE, regionCode: REGION });
  if (sessionToken) qs.set('sessionToken', sessionToken);
  const res = await request<any>(`https://places.googleapis.com/v1/places/${placeId}?${qs}`, {
    fieldMask: PLACE_FIELDS.join(','),
  });
  return mapPlace(res);
}

export async function searchText(query: string, near: LatLng | null, radius = 15000): Promise<Place[]> {
  const body: any = { textQuery: query, languageCode: LANGUAGE, regionCode: REGION, maxResultCount: 20 };
  if (near) body.locationBias = { circle: { center: toGoogle(near), radius } };
  const res = await request<any>('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    body: JSON.stringify(body),
    fieldMask: PLACE_FIELDS.map((f) => `places.${f}`).join(','),
  });
  return (res.places ?? []).map(mapPlace);
}

/* --------------------------------------------------------------- Geocoding */

export async function reverseGeocode(p: LatLng): Promise<{ address: string; road?: string; placeId?: string }> {
  const qs = new URLSearchParams({
    latlng: `${p.latitude},${p.longitude}`,
    language: LANGUAGE,
    key: GOOGLE_API_KEY,
  });
  const res = await request<any>(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
  const first = res.results?.[0];
  const road = res.results
    ?.flatMap((r: any) => r.address_components ?? [])
    .find((c: any) => c.types?.includes('route'))?.short_name;
  return { address: first?.formatted_address ?? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`, road, placeId: first?.place_id };
}

/* ------------------------------------------------------------------ Routes */

export type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' | 'TWO_WHEELER';
export type Speed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

export type SpeedInterval = { start: number; end: number; speed: Speed };

export type Step = {
  instruction: string;
  maneuver?: string;
  distanceMeters: number;
  durationSec: number;
  start: LatLng;
  end: LatLng;
  points: LatLng[];
  travelMode?: string;
  transit?: {
    line: string;
    color?: string;
    textColor?: string;
    vehicle?: string;
    headsign?: string;
    departureStop?: string;
    arrivalStop?: string;
    departureTime?: string;
    arrivalTime?: string;
    stopCount?: number;
  };
};

export type Route = {
  id: string;
  points: LatLng[];
  distanceMeters: number;
  durationSec: number; // with traffic
  staticDurationSec: number; // without traffic
  description?: string;
  labels: string[];
  warnings: string[];
  tolls: boolean;
  speedIntervals: SpeedInterval[];
  steps: Step[];
  mode: TravelMode;
};

export type RouteOptions = {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  alternatives?: boolean;
  /** Smaller response for background traffic scans */
  lite?: boolean;
};

const ROUTE_FIELDS_FULL = [
  'routes.duration', 'routes.staticDuration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline',
  'routes.description', 'routes.warnings', 'routes.routeLabels', 'routes.travelAdvisory.speedReadingIntervals',
  'routes.travelAdvisory.tollInfo', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.encodedPolyline', 'routes.legs.steps.startLocation', 'routes.legs.steps.endLocation',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.travelMode', 'routes.legs.steps.transitDetails',
].join(',');

const ROUTE_FIELDS_LITE = [
  'routes.duration', 'routes.staticDuration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline',
  'routes.travelAdvisory.speedReadingIntervals',
].join(',');

const ll = (l: any): LatLng => ({ latitude: l?.latLng?.latitude ?? 0, longitude: l?.latLng?.longitude ?? 0 });

export async function computeRoutes(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode,
  opts: RouteOptions = {},
): Promise<Route[]> {
  const trafficCapable = mode === 'DRIVE' || mode === 'TWO_WHEELER';
  const body: any = {
    origin: { location: { latLng: toGoogle(origin) } },
    destination: { location: { latLng: toGoogle(destination) } },
    travelMode: mode,
    languageCode: LANGUAGE,
    regionCode: REGION,
    units: 'METRIC',
    computeAlternativeRoutes: !!opts.alternatives && mode !== 'TRANSIT',
  };
  if (trafficCapable) {
    body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
    body.extraComputations = ['TRAFFIC_ON_POLYLINE', ...(opts.lite ? [] : ['TOLLS'])];
    body.routeModifiers = {
      avoidTolls: !!opts.avoidTolls,
      avoidHighways: !!opts.avoidHighways,
      avoidFerries: !!opts.avoidFerries,
    };
  }
  if (mode === 'TRANSIT') body.departureTime = new Date().toISOString();

  const res = await request<any>('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    body: JSON.stringify(body),
    fieldMask: opts.lite ? ROUTE_FIELDS_LITE : ROUTE_FIELDS_FULL,
  });

  return (res.routes ?? []).map((r: any, i: number): Route => {
    const points = decodePolyline(r.polyline?.encodedPolyline ?? '');
    const steps: Step[] = (r.legs ?? []).flatMap((leg: any) =>
      (leg.steps ?? []).map((s: any): Step => {
        const t = s.transitDetails;
        return {
          instruction: s.navigationInstruction?.instructions ?? '',
          maneuver: s.navigationInstruction?.maneuver,
          distanceMeters: s.distanceMeters ?? 0,
          durationSec: parseSeconds(s.staticDuration),
          start: ll(s.startLocation),
          end: ll(s.endLocation),
          points: decodePolyline(s.polyline?.encodedPolyline ?? ''),
          travelMode: s.travelMode,
          transit: t
            ? {
                line: t.transitLine?.nameShort ?? t.transitLine?.name ?? '',
                color: t.transitLine?.color,
                textColor: t.transitLine?.textColor,
                vehicle: t.transitLine?.vehicle?.name?.text,
                headsign: t.headsign,
                departureStop: t.stopDetails?.departureStop?.name,
                arrivalStop: t.stopDetails?.arrivalStop?.name,
                departureTime: t.localizedValues?.departureTime?.time?.text,
                arrivalTime: t.localizedValues?.arrivalTime?.time?.text,
                stopCount: t.stopCount,
              }
            : undefined,
        };
      }),
    );
    return {
      id: `${i}-${r.distanceMeters}-${r.duration}`,
      points,
      distanceMeters: r.distanceMeters ?? 0,
      durationSec: parseSeconds(r.duration),
      staticDurationSec: parseSeconds(r.staticDuration ?? r.duration),
      description: r.description,
      labels: r.routeLabels ?? [],
      warnings: r.warnings ?? [],
      tolls: !!r.travelAdvisory?.tollInfo,
      speedIntervals: (r.travelAdvisory?.speedReadingIntervals ?? []).map((s: any) => ({
        start: s.startPolylinePointIndex ?? 0,
        end: s.endPolylinePointIndex ?? 0,
        speed: (s.speed ?? 'NORMAL') as Speed,
      })),
      steps,
      mode,
    };
  });
}
