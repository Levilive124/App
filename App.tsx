import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { computeRoutes, placeDetails, reverseGeocode, type Place, type Route, type Suggestion, type TravelMode } from './src/api/google';
import { GOOGLE_API_KEY, IOS_GOOGLE_MAPS_AVAILABLE } from './src/config';
import { BottomSheet } from './src/components/BottomSheet';
import { IncidentBody, IncidentHeader } from './src/components/IncidentPanel';
import { LayersSheet } from './src/components/LayersSheet';
import { MapControls } from './src/components/MapControls';
import { NavigationHUD } from './src/components/NavigationHUD';
import { PlaceBody, PlaceHeader, ResultsHeader, ResultsList } from './src/components/PlacePanel';
import { RouteBody, RouteHeader } from './src/components/RoutePanel';
import { SearchHeader, SearchPanel } from './src/components/SearchPanel';
import { useLocation } from './src/hooks/useLocation';
import { useNavigation } from './src/hooks/useNavigation';
import { darkMapStyle } from './src/mapStyle';
import { defaultSettings, store, type SavedPlace, type Settings } from './src/storage';
import { trafficColor, useTheme } from './src/theme';
import { incidentsFromRoute, scanArea, withRoadNames, type Incident } from './src/traffic/incidents';
import { distance, type LatLng } from './src/utils/geo';
import { formatDuration } from './src/utils/format';

type View_ =
  | { kind: 'home' }
  | { kind: 'results'; query: string; places: Place[] }
  | { kind: 'place'; place: Place; from?: View_ }
  | { kind: 'route'; place: Place; from?: View_ }
  | { kind: 'incident'; incident: Incident; from: View_ };

const FALLBACK_REGION: Region = { latitude: 52.52, longitude: 13.405, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export default function App() {
  return (
    <SafeAreaProvider>
      <MapApp />
    </SafeAreaProvider>
  );
}

function MapApp() {
  const t = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [favorites, setFavorites] = useState<SavedPlace[]>([]);
  const [recents, setRecents] = useState<SavedPlace[]>([]);
  const [view, setView] = useState<View_>({ kind: 'home' });
  const [sheetIndex, setSheetIndex] = useState(1);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const [pendingKind, setPendingKind] = useState<'home' | 'work' | null>(null);
  const [droppedPin, setDroppedPin] = useState<LatLng | null>(null);

  const [mode, setMode] = useState<TravelMode>('DRIVE');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeIncidents, setRouteIncidents] = useState<Incident[]>([]);
  const [navigating, setNavigating] = useState(false);
  const [rerouting, setRerouting] = useState(false);

  const [region, setRegion] = useState<Region | null>(null);
  const [areaIncidents, setAreaIncidents] = useState<Incident[]>([]);
  const [areaLoading, setAreaLoading] = useState(false);
  const [error, setError] = useState<string | null>(GOOGLE_API_KEY ? null : 'Kein Google API-Schlüssel gesetzt. Lege GOOGLE_MAPS_API_KEY in der Datei .env an (siehe README).');

  const { fix, denied } = useLocation(navigating);
  const route = routes[selectedRoute] ?? null;

  /* ------------------------------------------------------------ persistence */
  useEffect(() => {
    store.settings().then(setSettings);
    store.favorites().then(setFavorites);
    store.recents().then(setRecents);
  }, []);

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      store.setSettings(next);
      return next;
    });
  }, []);

  const addRecent = (p: Place) => {
    const sp: SavedPlace = { id: p.id, name: p.name, address: p.address, location: p.location };
    setRecents((prev) => {
      const next = [sp, ...prev.filter((r) => r.id !== p.id)].slice(0, 15);
      store.setRecents(next);
      return next;
    });
  };

  const saveFavorite = (p: Place, kind: SavedPlace['kind'] = 'favorite') => {
    setFavorites((prev) => {
      const filtered = prev.filter((f) => f.id !== p.id && (kind === 'favorite' || f.kind !== kind));
      const next = [...filtered, { id: p.id, name: kind === 'home' ? 'Zuhause' : kind === 'work' ? 'Arbeit' : p.name, address: p.address, location: p.location, kind }];
      store.setFavorites(next);
      return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const removeFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = prev.filter((f) => f.id !== id);
      store.setFavorites(next);
      return next;
    });

  /* ------------------------------------------------------------- map camera */
  const snapPoints = useMemo(() => [insets.bottom + 92, Math.round(winH * 0.42), winH - insets.top - 12], [insets, winH]);
  const sheetHeight = navigating ? 120 + insets.bottom : snapPoints[Math.min(sheetIndex, 1)];

  const flyTo = useCallback((p: LatLng, delta = 0.012) => {
    setFollowing(false);
    mapRef.current?.animateToRegion(
      // shift the centre down a bit so the target is not hidden behind the sheet
      { latitude: p.latitude - delta * 0.25, longitude: p.longitude, latitudeDelta: delta, longitudeDelta: delta },
      600,
    );
  }, []);

  const fitRoute = useCallback(
    (r: Route | null) => {
      if (!r || r.points.length < 2) return;
      mapRef.current?.fitToCoordinates(r.points, {
        edgePadding: { top: insets.top + 60, right: 60, bottom: snapPoints[1] + 30, left: 40 },
        animated: true,
      });
    },
    [insets.top, snapPoints],
  );

  // follow the user
  const didCenter = useRef(false);
  useEffect(() => {
    if (!fix) return;
    if (!didCenter.current) {
      didCenter.current = true;
      mapRef.current?.animateToRegion({ ...fix, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
      return;
    }
    if (!following) return;
    if (navigating) {
      mapRef.current?.animateCamera(
        {
          center: nav?.snapped ?? fix,
          heading: fix.heading ?? undefined,
          pitch: settings.threeD ? 60 : 0,
          zoom: (fix.speed ?? 0) > 25 ? 16 : 17.5,
          altitude: (fix.speed ?? 0) > 25 ? 900 : 450,
        },
        { duration: 900 },
      );
    } else if (view.kind === 'home') {
      mapRef.current?.animateCamera({ center: fix }, { duration: 500 });
    }
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = () => {
    if (!fix) return;
    Haptics.selectionAsync().catch(() => {});
    setFollowing(true);
    if (navigating) return;
    mapRef.current?.animateCamera(
      { center: fix, zoom: 16, altitude: 1200, heading: following && fix.heading != null ? fix.heading : 0, pitch: settings.threeD ? 45 : 0 },
      { duration: 500 },
    );
  };

  /* ---------------------------------------------------------- area traffic */
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runScan = useCallback(
    async (r: Region | null, force = false) => {
      if (!r || !GOOGLE_API_KEY || navigating) return;
      if (r.latitudeDelta > 1.2) return; // too far zoomed out
      setAreaLoading(true);
      try {
        const radius = (r.latitudeDelta * 111000) / 2;
        const found = await scanArea({ latitude: r.latitude, longitude: r.longitude }, radius, force);
        setAreaIncidents(found);
        setError(null);
        withRoadNames(found).then(setAreaIncidents);
      } catch (e: any) {
        setError(e?.message ?? 'Verkehrsdaten konnten nicht geladen werden.');
      } finally {
        setAreaLoading(false);
      }
    },
    [navigating],
  );

  const onRegionChangeComplete = (r: Region) => {
    setRegion(r);
    if (!settings.incidents) return;
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => runScan(r), 1200);
  };

  useEffect(() => {
    if (settings.incidents && region) runScan(region);
  }, [settings.incidents]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- routing */
  const routeTarget = view.kind === 'route' ? view.place : null;
  const loadRoutes = useCallback(
    async (target: Place, m: TravelMode, opts: { quiet?: boolean; fit?: boolean } = {}) => {
      if (!fix) {
        setRouteError(denied ? 'Standortzugriff verweigert – Route kann nicht berechnet werden.' : 'Warte auf GPS-Standort …');
        return;
      }
      if (!opts.quiet) {
        setRouteLoading(true);
        setRouteError(null);
      }
      try {
        const res = await computeRoutes(fix, target.location, m, {
          alternatives: !navigating,
          avoidTolls: settings.avoidTolls,
          avoidHighways: settings.avoidHighways,
          avoidFerries: settings.avoidFerries,
        });
        if (!res.length) throw new Error('Keine Route gefunden.');
        setRoutes(res);
        setSelectedRoute(0);
        if (opts.fit) fitRoute(res[0]);
      } catch (e: any) {
        if (!opts.quiet) {
          setRoutes([]);
          setRouteError(e?.message ?? 'Route konnte nicht berechnet werden.');
        }
      } finally {
        setRouteLoading(false);
        setRerouting(false);
      }
    },
    [fix, denied, navigating, settings.avoidTolls, settings.avoidHighways, settings.avoidFerries, fitRoute],
  );

  // (re)load routes when the target, mode or options change
  useEffect(() => {
    if (routeTarget && !navigating) loadRoutes(routeTarget, mode, { fit: true });
  }, [routeTarget?.id, mode, settings.avoidTolls, settings.avoidHighways, settings.avoidFerries, !!fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // disruptions along the selected route
  useEffect(() => {
    if (!route) return setRouteIncidents([]);
    const list = incidentsFromRoute(route);
    setRouteIncidents(list);
    let alive = true;
    withRoadNames(list).then((named) => alive && setRouteIncidents(named));
    return () => {
      alive = false;
    };
  }, [route]);

  useEffect(() => {
    if (!routeTarget) {
      setRoutes([]);
      setRouteError(null);
    }
  }, [routeTarget]);

  /* ------------------------------------------------------------- navigation */
  const onReroute = useCallback(
    (reason: 'offroute' | 'traffic') => {
      if (!routeTarget) return;
      if (reason === 'offroute') setRerouting(true);
      loadRoutes(routeTarget, mode, { quiet: true });
    },
    [routeTarget, mode, loadRoutes],
  );
  const nav = useNavigation(route, routeIncidents, fix, navigating, settings.voice, onReroute);

  const startNavigation = () => {
    if (!route) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRoutes([route]);
    setSelectedRoute(0);
    setNavigating(true);
    setFollowing(true);
    activateKeepAwakeAsync('nav').catch(() => {});
  };

  const endNavigation = () => {
    setNavigating(false);
    deactivateKeepAwake('nav').catch(() => {});
    setView({ kind: 'home' });
    setSheetIndex(1);
    setFollowing(true);
    if (fix) mapRef.current?.animateCamera({ center: fix, heading: 0, pitch: 0, zoom: 15, altitude: 2500 }, { duration: 800 });
  };

  /* ------------------------------------------------------------ interaction */
  const openPlace = (place: Place, from?: View_) => {
    setDroppedPin(null);
    addRecent(place);
    if (pendingKind) {
      saveFavorite(place, pendingKind);
      setPendingKind(null);
    }
    setView({ kind: 'place', place, from });
    setSheetIndex(1);
    flyTo(place.location);
  };

  const onSuggestion = async (s: Suggestion, token: string) => {
    if (!s.placeId) return;
    setSearchLoading(true);
    try {
      const place = await placeDetails(s.placeId, token);
      setQuery('');
      setSearchFocused(false);
      openPlace(place);
    } catch (e: any) {
      setError(e?.message ?? 'Ort konnte nicht geladen werden.');
    } finally {
      setSearchLoading(false);
    }
  };

  const onResults = (q: string, places: Place[]) => {
    setSearchFocused(false);
    setQuery('');
    setView({ kind: 'results', query: q, places });
    setSheetIndex(1);
    if (places.length) {
      const pts = places.map((p) => p.location);
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: insets.top + 60, right: 60, bottom: snapPoints[1] + 30, left: 40 },
        animated: true,
      });
    }
  };

  const onSaved = (s: SavedPlace) => {
    const place: Place = { id: s.id, name: s.kind === 'favorite' || !s.kind ? s.name : s.address || s.name, address: s.address, location: s.location };
    if (s.kind === 'home' || s.kind === 'work') {
      setView({ kind: 'route', place: { ...place, name: s.name } });
      setSheetIndex(1);
    } else openPlace(place);
  };

  const onLongPress = async (e: { nativeEvent: { coordinate: LatLng } }) => {
    if (navigating) return;
    const c = e.nativeEvent.coordinate;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDroppedPin(c);
    const base: Place = { id: `pin-${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`, name: 'Markierter Ort', address: '', location: c };
    setView({ kind: 'place', place: base });
    setSheetIndex(1);
    try {
      const r = await reverseGeocode(c);
      setView((v) => (v.kind === 'place' && v.place.id === base.id ? { kind: 'place', place: { ...base, address: r.address } } : v));
    } catch {}
  };

  const openIncident = (incident: Incident) => {
    setView((v) => ({ kind: 'incident', incident, from: v.kind === 'incident' ? v.from : v }));
    setSheetIndex(1);
    if (!navigating) flyTo(incident.position, 0.02);
  };

  const goBack = useCallback(() => {
    if (layersOpen) return setLayersOpen(false), true;
    if (navigating) return true;
    if (searchFocused) return setSearchFocused(false), true;
    switch (view.kind) {
      case 'incident':
        setView(view.from);
        return true;
      case 'route':
      case 'place':
        setDroppedPin(null);
        setView(view.from ?? { kind: 'home' });
        return true;
      case 'results':
        setView({ kind: 'home' });
        return true;
    }
    return false;
  }, [view, navigating, searchFocused, layersOpen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]);

  /* ------------------------------------------------------------- rendering */
  const useGoogle = Platform.OS === 'android' || (settings.googleOnIos && IOS_GOOGLE_MAPS_AVAILABLE);
  const showRoutes = view.kind === 'route' || navigating || (view.kind === 'incident' && view.from.kind === 'route');
  const visibleIncidents = !settings.incidents ? [] : showRoutes ? routeIncidents : areaIncidents;
  const selectedIncident = view.kind === 'incident' ? view.incident : null;
  const traveledSplit = navigating && nav?.snapped ? nav.snapped : null;

  const trafficSegments = useMemo(() => {
    if (!route) return [];
    if (!route.speedIntervals.length) return [{ points: route.points, color: trafficColor.NORMAL }];
    return route.speedIntervals
      .map((iv) => ({ points: route.points.slice(iv.start, iv.end + 1), color: trafficColor[iv.speed] }))
      .filter((s) => s.points.length >= 2);
  }, [route]);

  const isFavorite = (id: string) => favorites.some((f) => f.id === id);

  let header: React.ReactNode = null;
  let body: React.ReactNode = null;
  switch (view.kind) {
    case 'home':
      header = (
        <SearchHeader
          value={query}
          onChange={setQuery}
          focused={searchFocused}
          loading={searchLoading}
          onFocus={() => {
            setSearchFocused(true);
            setSheetIndex(2);
          }}
          onCancel={() => {
            setSearchFocused(false);
            setQuery('');
            setPendingKind(null);
            setSheetIndex(1);
          }}
        />
      );
      body = (
        <>
          {pendingKind && (
            <Text style={{ color: t.accent, paddingHorizontal: 16, paddingBottom: 6 }}>
              Suche die Adresse für „{pendingKind === 'home' ? 'Zuhause' : 'Arbeit'}“
            </Text>
          )}
          <SearchPanel
            query={query}
            setQuery={setQuery}
            focused={searchFocused}
            setLoading={setSearchLoading}
            near={fix ?? (region ? { latitude: region.latitude, longitude: region.longitude } : null)}
            favorites={favorites}
            recents={recents}
            incidents={settings.incidents ? areaIncidents : []}
            incidentsLoading={areaLoading}
            onFocus={() => setSheetIndex(2)}
            onSuggestion={onSuggestion}
            onResults={onResults}
            onSaved={onSaved}
            onRemoveSaved={(p) => removeFavorite(p.id)}
            onIncident={openIncident}
            onRefreshIncidents={() => runScan(region, true)}
            onSetHomeWork={(kind) => {
              setPendingKind(kind);
              setSearchFocused(true);
              setSheetIndex(2);
            }}
            error={error}
          />
        </>
      );
      break;
    case 'results':
      header = <ResultsHeader query={view.query} count={view.places.length} onClose={goBack} />;
      body = <ResultsList places={view.places} near={fix} onSelect={(p) => openPlace(p, view)} />;
      break;
    case 'place': {
      const place = view.place;
      header = <PlaceHeader place={place} near={fix} onClose={goBack} />;
      body = (
        <PlaceBody
          place={place}
          isFavorite={isFavorite(place.id)}
          routeLoading={false}
          etaText={fix ? undefined : 'Route'}
          onRoute={() => {
            setView({ kind: 'route', place, from: view });
            setSheetIndex(1);
          }}
          onToggleFavorite={() => (isFavorite(place.id) ? removeFavorite(place.id) : saveFavorite(place))}
        />
      );
      break;
    }
    case 'route':
      header = <RouteHeader destinationName={view.place.name} mode={mode} onMode={setMode} onClose={goBack} />;
      body = (
        <RouteBody
          routes={routes}
          selected={selectedRoute}
          onSelect={(i) => {
            setSelectedRoute(i);
            Haptics.selectionAsync().catch(() => {});
          }}
          loading={routeLoading}
          error={routeError}
          incidents={routeIncidents}
          onIncident={openIncident}
          onStart={startNavigation}
          settings={settings}
          onSettings={updateSettings}
          mode={mode}
        />
      );
      break;
    case 'incident':
      header = <IncidentHeader incident={view.incident} onClose={goBack} />;
      body = <IncidentBody incident={view.incident} />;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={navigating ? 'light' : 'auto'} />
      <MapView
        key={useGoogle ? 'google' : 'apple'}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={useGoogle ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={FALLBACK_REGION}
        mapType={settings.mapType}
        showsTraffic={settings.traffic}
        showsBuildings={settings.threeD}
        pitchEnabled
        rotateEnabled
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={!navigating}
        showsScale
        showsPointsOfInterests
        toolbarEnabled={false}
        userInterfaceStyle={scheme === 'dark' ? 'dark' : 'light'}
        customMapStyle={useGoogle && scheme === 'dark' && settings.mapType === 'standard' ? darkMapStyle : undefined}
        mapPadding={{ top: navigating ? insets.top + 140 : insets.top, right: 0, bottom: sheetHeight, left: 0 }}
        onPanDrag={() => following && setFollowing(false)}
        onLongPress={onLongPress}
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {/* alternative routes (tap to select) */}
        {showRoutes &&
          !navigating &&
          routes.map((r, i) =>
            i === selectedRoute ? null : (
              <Polyline
                key={r.id}
                coordinates={r.points}
                strokeColor={scheme === 'dark' ? '#5E6B7D' : '#A3B5CC'}
                strokeWidth={6}
                tappable
                onPress={() => setSelectedRoute(i)}
                zIndex={1}
              />
            ),
          )}

        {/* selected route, coloured by live traffic */}
        {showRoutes && route && (
          <>
            <Polyline coordinates={route.points} strokeColor="#0B4FA8" strokeWidth={11} zIndex={2} lineCap="round" lineJoin="round" />
            {trafficSegments.map((s, i) => (
              <Polyline key={i} coordinates={s.points} strokeColor={s.color} strokeWidth={7} zIndex={3} lineCap="round" lineJoin="round" />
            ))}
            {route.mode === 'WALK' && <Polyline coordinates={route.points} strokeColor="#fff" strokeWidth={2} lineDashPattern={[2, 8]} zIndex={4} />}
            {traveledSplit && nav && (
              <Marker coordinate={traveledSplit} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={false}>
                <View style={[styles.puck, { backgroundColor: t.accent }]}>
                  <MaterialCommunityIcons name="navigation" size={18} color="#fff" />
                </View>
              </Marker>
            )}
            <Marker coordinate={route.points[route.points.length - 1]} tracksViewChanges={false}>
              <View style={[styles.dest, { backgroundColor: t.red }]}>
                <MaterialCommunityIcons name="flag-checkered" size={16} color="#fff" />
              </View>
            </Marker>
          </>
        )}

        {/* traffic disruptions */}
        {visibleIncidents.map((inc) => (
          <Marker
            key={inc.id}
            coordinate={inc.position}
            onPress={() => openIncident(inc)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={10}
          >
            <View style={[styles.incident, { backgroundColor: inc.kind === 'JAM' ? t.red : t.orange }]}>
              <MaterialCommunityIcons name="car-brake-alert" size={15} color="#fff" />
              {inc.delaySec >= 120 && <Text style={styles.incidentText}>+{Math.round(inc.delaySec / 60)}</Text>}
            </View>
          </Marker>
        ))}
        {selectedIncident && (
          <Polyline
            coordinates={selectedIncident.points}
            strokeColor={selectedIncident.kind === 'JAM' ? '#B0001A' : '#D47500'}
            strokeWidth={10}
            zIndex={5}
          />
        )}

        {/* search results */}
        {view.kind === 'results' &&
          view.places.map((p) => (
            <Marker key={p.id} coordinate={p.location} title={p.name} description={p.category} pinColor="red" onCalloutPress={() => openPlace(p, view)} onPress={() => openPlace(p, view)} />
          ))}
        {view.kind === 'place' && <Marker coordinate={view.place.location} pinColor={droppedPin ? 'purple' : 'red'} />}
        {view.kind === 'route' && !route && <Marker coordinate={view.place.location} />}

        {/* favourites */}
        {!navigating &&
          view.kind === 'home' &&
          favorites.map((f) => (
            <Marker key={f.id} coordinate={f.location} onPress={() => onSaved(f)} tracksViewChanges={false}>
              <View style={[styles.fav, { backgroundColor: f.kind === 'home' ? '#0A84FF' : f.kind === 'work' ? '#A2845E' : '#FFCC00' }]}>
                <MaterialCommunityIcons name={f.kind === 'home' ? 'home' : f.kind === 'work' ? 'briefcase' : 'star'} size={14} color="#fff" />
              </View>
            </Marker>
          ))}
      </MapView>

      {!navigating && (
        <MapControls
          top={insets.top + 10}
          following={following}
          traffic={settings.traffic}
          incidents={settings.incidents}
          threeD={settings.threeD}
          onLayers={() => setLayersOpen(true)}
          onLocate={locate}
          onToggleTraffic={() => updateSettings({ traffic: !settings.traffic })}
          onToggleIncidents={() => updateSettings({ incidents: !settings.incidents })}
          onToggle3D={() => updateSettings({ threeD: !settings.threeD })}
        />
      )}

      {!navigating && sheetIndex < 2 && route && view.kind === 'route' && route.durationSec - route.staticDurationSec > 60 && (
        <View style={[styles.trafficPill, { top: insets.top + 12, backgroundColor: t.sheet }]}>
          <View style={[styles.dot, { backgroundColor: route.durationSec - route.staticDurationSec > 600 ? t.red : t.orange }]} />
          <Text style={{ color: t.text, fontWeight: '600' }}>+{formatDuration(route.durationSec - route.staticDurationSec)} Verkehr</Text>
        </View>
      )}

      {navigating && route ? (
        <>
          <NavigationHUD
            route={route}
            nav={nav}
            voice={settings.voice}
            rerouting={rerouting}
            onToggleVoice={() => updateSettings({ voice: !settings.voice })}
            onEnd={endNavigation}
            onOverview={() => {
              setFollowing(false);
              fitRoute(route);
            }}
          />
          {!following && (
            <View style={[styles.recenter, { bottom: insets.bottom + 110 }]}>
              <Text onPress={locate} style={[styles.recenterText, { backgroundColor: t.sheet, color: t.accent }]}>
                Zentrieren
              </Text>
            </View>
          )}
        </>
      ) : (
        <BottomSheet snapPoints={snapPoints} index={sheetIndex} onIndexChange={setSheetIndex} header={header}>
          {body}
        </BottomSheet>
      )}

      <LayersSheet visible={layersOpen} settings={settings} onChange={updateSettings} onClose={() => setLayersOpen(false)} />

      {denied && !navigating && (
        <View style={[styles.toast, { top: insets.top + 12, backgroundColor: t.sheet }]}>
          <MaterialCommunityIcons name="crosshairs-off" size={16} color={t.orange} />
          <Text style={{ color: t.text, marginLeft: 6, fontSize: 13 }}>Standortzugriff deaktiviert</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  incident: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 26, minWidth: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', justifyContent: 'center' },
  incidentText: { color: '#fff', fontWeight: '800', fontSize: 11, marginLeft: 2 },
  dest: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  puck: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  fav: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  trafficPill: { position: 'absolute', left: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, gap: 6, elevation: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  recenter: { position: 'absolute', alignSelf: 'center' },
  recenterText: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, fontWeight: '700', overflow: 'hidden' },
  toast: { position: 'absolute', left: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
});
