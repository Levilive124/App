import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Route, TravelMode } from '../api/google';
import { incidentTitle, type Incident } from '../traffic/incidents';
import { useTheme } from '../theme';
import type { Settings } from '../storage';
import { formatClock, formatDistance, formatDuration } from '../utils/format';
import { maneuverIcon, modeIcon, modeLabel } from '../utils/maneuver';
import { CloseButton, ListRow, SectionTitle } from './ui';

const MODES: TravelMode[] = ['DRIVE', 'TRANSIT', 'WALK', 'BICYCLE', 'TWO_WHEELER'];

export function RouteHeader({
  destinationName, mode, onMode, onClose,
}: { destinationName: string; mode: TravelMode; onMode: (m: TravelMode) => void; onClose: () => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>Route nach {destinationName}</Text>
          <Text style={{ color: t.sub, fontSize: 14 }}>Von: Mein Standort</Text>
        </View>
        <CloseButton onPress={onClose} />
      </View>
      <View style={[styles.segment, { backgroundColor: t.field }]}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => onMode(m)} style={[styles.segItem, m === mode && { backgroundColor: t.card }]}>
            <MaterialCommunityIcons name={modeIcon[m]} size={20} color={m === mode ? t.accent : t.sub} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type BodyProps = {
  routes: Route[];
  selected: number;
  onSelect: (i: number) => void;
  loading: boolean;
  error: string | null;
  incidents: Incident[];
  onIncident: (i: Incident) => void;
  onStart: () => void;
  settings: Settings;
  onSettings: (s: Partial<Settings>) => void;
  mode: TravelMode;
};

export function RouteBody(p: BodyProps) {
  const t = useTheme();
  const [showSteps, setShowSteps] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const route = p.routes[p.selected];

  if (p.loading && !p.routes.length) {
    return <ActivityIndicator style={{ marginTop: 30 }} />;
  }
  if (p.error) {
    return <Text style={{ color: t.red, padding: 16 }}>{p.error}</Text>;
  }
  if (!route) return <Text style={{ color: t.sub, padding: 16 }}>Keine Route gefunden.</Text>;

  const trafficMode = p.mode === 'DRIVE' || p.mode === 'TWO_WHEELER';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      {p.routes.map((r, i) => {
        const delay = r.durationSec - r.staticDurationSec;
        const active = i === p.selected;
        const delayColor = delay > 600 ? t.red : delay > 120 ? t.orange : t.green;
        return (
          <Pressable
            key={r.id}
            onPress={() => p.onSelect(i)}
            style={[styles.routeCard, { backgroundColor: t.card, borderColor: active ? t.accent : 'transparent' }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.eta, { color: t.text }]}>{formatDuration(r.durationSec)}</Text>
              <Text style={{ color: t.sub, fontSize: 14, marginTop: 2 }}>
                {formatDistance(r.distanceMeters)} · Ankunft {formatClock(new Date(Date.now() + r.durationSec * 1000))}
              </Text>
              {trafficMode && (
                <Text style={{ color: delayColor, fontSize: 14, marginTop: 2, fontWeight: '600' }}>
                  {delay > 60 ? `+${formatDuration(delay)} durch Verkehr` : 'Normaler Verkehr'}
                </Text>
              )}
              <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                {[r.description && `über ${r.description}`, r.labels.includes('FUEL_EFFICIENT') && 'Kraftstoffsparend', r.tolls && 'Maut']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {active && (
              <Pressable onPress={p.onStart} style={[styles.go, { backgroundColor: t.green }]}>
                <Text style={styles.goText}>Los</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}

      {trafficMode && (
        <>
          <SectionTitle>Verkehrsstörungen auf der Route</SectionTitle>
          {p.incidents.length === 0 ? (
            <View style={styles.okRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color={t.green} />
              <Text style={{ color: t.text, marginLeft: 8 }}>Keine Störungen gemeldet</Text>
            </View>
          ) : (
            p.incidents.map((inc) => (
              <ListRow
                key={inc.id}
                icon={inc.kind === 'JAM' ? 'car-brake-alert' : 'car-multiple'}
                iconBg={inc.kind === 'JAM' ? t.red : t.orange}
                title={incidentTitle(inc)}
                subtitle={`in ${formatDistance(inc.atMeters ?? 0)} · ${formatDistance(inc.lengthMeters)} lang · ca. +${formatDuration(inc.delaySec)}`}
                onPress={() => p.onIncident(inc)}
              />
            ))
          )}
        </>
      )}

      {route.warnings.map((w) => (
        <View key={w} style={styles.okRow}>
          <MaterialCommunityIcons name="alert" size={18} color={t.orange} />
          <Text style={{ color: t.text, marginLeft: 8, flex: 1 }}>{w}</Text>
        </View>
      ))}

      {p.mode === 'TRANSIT' && <TransitSteps route={route} />}

      {trafficMode && (
        <>
          <Pressable onPress={() => setShowOptions((s) => !s)}>
            <SectionTitle right={<MaterialCommunityIcons name={showOptions ? 'chevron-up' : 'chevron-down'} size={22} color={t.sub} />}>
              Optionen
            </SectionTitle>
          </Pressable>
          {showOptions && (
            <View style={[styles.optCard, { backgroundColor: t.card }]}>
              <Opt label="Maut vermeiden" value={p.settings.avoidTolls} onChange={(v) => p.onSettings({ avoidTolls: v })} />
              <Opt label="Autobahnen vermeiden" value={p.settings.avoidHighways} onChange={(v) => p.onSettings({ avoidHighways: v })} />
              <Opt label="Fähren vermeiden" value={p.settings.avoidFerries} onChange={(v) => p.onSettings({ avoidFerries: v })} />
            </View>
          )}
        </>
      )}

      {p.mode !== 'TRANSIT' && (
        <>
          <Pressable onPress={() => setShowSteps((s) => !s)}>
            <SectionTitle right={<MaterialCommunityIcons name={showSteps ? 'chevron-up' : 'chevron-down'} size={22} color={t.sub} />}>
              Wegbeschreibung ({route.steps.length})
            </SectionTitle>
          </Pressable>
          {showSteps &&
            route.steps.map((s, i) => (
              <ListRow key={i} icon={maneuverIcon(s.maneuver)} iconBg="#8E8E93" title={s.instruction || modeLabel[p.mode]} subtitle={formatDistance(s.distanceMeters)} />
            ))}
        </>
      )}
    </ScrollView>
  );
}

function Opt({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={styles.opt}>
      <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function TransitSteps({ route }: { route: Route }) {
  const t = useTheme();
  return (
    <View style={[styles.optCard, { backgroundColor: t.card, marginTop: 16 }]}>
      {route.steps
        .reduce<typeof route.steps>((acc, s) => {
          // collapse consecutive walking steps
          const last = acc[acc.length - 1];
          if (!s.transit && last && !last.transit) {
            acc[acc.length - 1] = { ...last, distanceMeters: last.distanceMeters + s.distanceMeters, durationSec: last.durationSec + s.durationSec };
          } else acc.push(s);
          return acc;
        }, [])
        .map((s, i) =>
          s.transit ? (
            <View key={i} style={styles.transitRow}>
              <View style={[styles.lineBadge, { backgroundColor: s.transit.color ?? t.accent }]}>
                <Text style={{ color: s.transit.textColor ?? '#fff', fontWeight: '800' }}>{s.transit.line}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>
                  {s.transit.vehicle ?? 'Linie'} Richtung {s.transit.headsign}
                </Text>
                <Text style={{ color: t.sub, fontSize: 13 }}>
                  {s.transit.departureTime} {s.transit.departureStop} → {s.transit.arrivalTime} {s.transit.arrivalStop}
                  {s.transit.stopCount ? ` · ${s.transit.stopCount} Halte` : ''}
                </Text>
              </View>
            </View>
          ) : (
            <View key={i} style={styles.transitRow}>
              <MaterialCommunityIcons name="walk" size={22} color={t.sub} />
              <Text style={{ color: t.sub, marginLeft: 10 }}>
                {formatDistance(s.distanceMeters)} gehen · {formatDuration(s.durationSec)}
              </Text>
            </View>
          ),
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700' },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2, marginTop: 12 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7 },
  routeCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 2 },
  eta: { fontSize: 26, fontWeight: '700' },
  go: { paddingHorizontal: 26, paddingVertical: 14, borderRadius: 12, marginLeft: 10 },
  goText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  okRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  optCard: { marginHorizontal: 16, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  transitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  lineBadge: { minWidth: 40, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, alignItems: 'center' },
});
