import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '../api/google';
import type { NavState } from '../hooks/useNavigation';
import { useTheme } from '../theme';
import { formatClock, formatDistance, formatDuration } from '../utils/format';
import { maneuverIcon } from '../utils/maneuver';

type Props = {
  route: Route;
  nav: NavState | null;
  voice: boolean;
  onToggleVoice: () => void;
  onEnd: () => void;
  onOverview: () => void;
  rerouting: boolean;
};

export function NavigationHUD({ route, nav, voice, onToggleVoice, onEnd, onOverview, rerouting }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const stepIndex = nav?.stepIndex ?? 0;
  const next = route.steps[stepIndex + 1] ?? route.steps[stepIndex];
  const after = route.steps[stepIndex + 2];
  const remainingSec = nav?.remainingSec ?? route.durationSec;
  const delay = route.durationSec - route.staticDurationSec;

  return (
    <>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {nav?.arrived ? (
          <View style={styles.topRow}>
            <MaterialCommunityIcons name="flag-checkered" size={44} color="#fff" />
            <Text style={[styles.instr, { marginLeft: 14 }]}>Ziel erreicht</Text>
          </View>
        ) : (
          <>
            <View style={styles.topRow}>
              <MaterialCommunityIcons name={maneuverIcon(next?.maneuver)} size={52} color="#fff" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.dist}>{formatDistance(nav?.distToManeuver ?? route.steps[0]?.distanceMeters ?? 0)}</Text>
                <Text style={styles.instr} numberOfLines={3}>
                  {rerouting ? 'Route wird neu berechnet …' : next?.instruction || 'Der Route folgen'}
                </Text>
              </View>
            </View>
            {!!after && (
              <View style={styles.then}>
                <Text style={styles.thenText}>Dann</Text>
                <MaterialCommunityIcons name={maneuverIcon(after.maneuver)} size={20} color="#fff" />
              </View>
            )}
          </>
        )}
      </View>

      {nav?.nextIncident && nav.nextIncident.distance < 15000 && (
        <View style={[styles.alert, { top: insets.top + 150, backgroundColor: nav.nextIncident.incident.kind === 'JAM' ? t.red : t.orange }]}>
          <MaterialCommunityIcons name="car-brake-alert" size={20} color="#fff" />
          <Text style={styles.alertText} numberOfLines={1}>
            {nav.nextIncident.incident.kind === 'JAM' ? 'Stau' : 'Stockender Verkehr'} in {formatDistance(nav.nextIncident.distance)}
            {' · '}ca. +{formatDuration(nav.nextIncident.incident.delaySec)}
          </Text>
        </View>
      )}

      <View style={[styles.bottom, { backgroundColor: t.sheet, paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={onToggleVoice} style={[styles.roundBtn, { backgroundColor: t.field }]}>
          <MaterialCommunityIcons name={voice ? 'volume-high' : 'volume-off'} size={22} color={t.text} />
        </Pressable>
        <Pressable onPress={onOverview} style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Stat value={formatClock(new Date(Date.now() + remainingSec * 1000))} label="Ankunft" />
            <Stat value={formatDuration(remainingSec)} label="Fahrzeit" color={delay > 300 ? t.orange : t.green} />
            <Stat value={formatDistance(nav?.remainingMeters ?? route.distanceMeters)} label="Distanz" />
          </View>
        </Pressable>
        <Pressable onPress={onEnd} style={[styles.end, { backgroundColor: t.red }]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Beenden</Text>
        </Pressable>
      </View>
    </>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', marginHorizontal: 8 }}>
      <Text style={{ color: color ?? t.text, fontSize: 19, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: t.sub, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#1C6B3A', paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, elevation: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  dist: { color: '#fff', fontSize: 34, fontWeight: '800' },
  instr: { color: '#fff', fontSize: 19, fontWeight: '600' },
  then: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 10, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, gap: 6 },
  thenText: { color: '#fff', fontWeight: '600' },
  alert: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, gap: 8, elevation: 8 },
  alertText: { color: '#fff', fontWeight: '700', flex: 1 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingHorizontal: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, elevation: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  roundBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  end: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
});
