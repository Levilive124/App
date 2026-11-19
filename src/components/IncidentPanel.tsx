import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { incidentTitle, type Incident } from '../traffic/incidents';
import { useTheme } from '../theme';
import { formatDistance, formatDuration } from '../utils/format';
import { CloseButton } from './ui';

const COMPASS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];

export function IncidentHeader({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const t = useTheme();
  const color = incident.kind === 'JAM' ? t.red : t.orange;
  return (
    <View style={styles.header}>
      <View style={[styles.icon, { backgroundColor: color }]}>
        <MaterialCommunityIcons name="car-brake-alert" size={26} color="#fff" />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>{incidentTitle(incident)}</Text>
        <Text style={{ color: t.sub }}>Live-Verkehrsdaten · Google</Text>
      </View>
      <CloseButton onPress={onClose} />
    </View>
  );
}

export function IncidentBody({ incident }: { incident: Incident }) {
  const t = useTheme();
  const dir = COMPASS[Math.round(incident.heading / 45) % 8];
  const speedKmh = incident.delaySec > 0 ? (incident.lengthMeters / (incident.lengthMeters / 13.9 + incident.delaySec)) * 3.6 : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0 }}>
      <View style={[styles.card, { backgroundColor: t.card }]}>
        <Item icon="ruler" label="Länge" value={formatDistance(incident.lengthMeters)} />
        <Item icon="clock-alert-outline" label="Geschätzte Verzögerung" value={`ca. +${formatDuration(incident.delaySec)}`} />
        {speedKmh != null && <Item icon="speedometer-slow" label="Ø Geschwindigkeit" value={`ca. ${Math.round(speedKmh)} km/h`} />}
        <Item icon="compass-outline" label="Fahrtrichtung" value={`Richtung ${dir}`} />
        {incident.atMeters != null && <Item icon="map-marker-distance" label="Auf deiner Route in" value={formatDistance(incident.atMeters)} />}
      </View>
      <Text style={{ color: t.sub, fontSize: 12, marginTop: 10 }}>
        Erkannt aus den Echtzeit-Geschwindigkeitsdaten der Google Routes API (speedReadingIntervals). Verzögerung ist eine Schätzung.
      </Text>
    </ScrollView>
  );
}

function Item({ icon, label, value }: { icon: any; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.item}>
      <MaterialCommunityIcons name={icon} size={20} color={t.sub} />
      <Text style={{ color: t.sub, marginLeft: 10, flex: 1 }}>{label}</Text>
      <Text style={{ color: t.text, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  card: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
