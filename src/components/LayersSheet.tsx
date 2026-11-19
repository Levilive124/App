import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IOS_GOOGLE_MAPS_AVAILABLE } from '../config';
import type { Settings } from '../storage';
import { useTheme } from '../theme';
import { CloseButton } from './ui';

const TYPES: { key: Settings['mapType']; label: string; icon: any }[] = [
  { key: 'standard', label: 'Standard', icon: 'map-outline' },
  { key: 'hybrid', label: 'Hybrid', icon: 'map-legend' },
  { key: 'satellite', label: 'Satellit', icon: 'earth' },
  { key: 'terrain', label: 'Gelände', icon: 'terrain' },
];

export function LayersSheet({ visible, settings, onChange, onClose }: {
  visible: boolean; settings: Settings; onChange: (s: Partial<Settings>) => void; onClose: () => void;
}) {
  const t = useTheme();
  const types = Platform.OS === 'ios' && !settings.googleOnIos ? TYPES.filter((x) => x.key !== 'terrain') : TYPES;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.sheet }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]}>Karten auswählen</Text>
          <CloseButton onPress={onClose} />
        </View>
        <View style={styles.types}>
          {types.map((ty) => {
            const active = settings.mapType === ty.key;
            return (
              <Pressable key={ty.key} onPress={() => onChange({ mapType: ty.key })} style={[styles.type, { backgroundColor: t.card, borderColor: active ? t.accent : 'transparent' }]}>
                <MaterialCommunityIcons name={ty.icon} size={30} color={active ? t.accent : t.sub} />
                <Text style={{ color: t.text, fontWeight: '600', marginTop: 6 }}>{ty.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.card, { backgroundColor: t.card }]}>
          <Row label="Live-Verkehr" sub="Verkehrsfluss als Kartenebene" value={settings.traffic} onChange={(v) => onChange({ traffic: v })} />
          <Row label="Verkehrsstörungen" sub="Staus & stockender Verkehr (Google Routes)" value={settings.incidents} onChange={(v) => onChange({ incidents: v })} />
          <Row label="3D-Ansicht" sub="Gebäude & geneigte Karte" value={settings.threeD} onChange={(v) => onChange({ threeD: v })} />
          <Row label="Sprachansagen" value={settings.voice} onChange={(v) => onChange({ voice: v })} />
          {Platform.OS === 'ios' && IOS_GOOGLE_MAPS_AVAILABLE && (
            <Row label="Google-Kartendarstellung" sub="Aus: Apple Karten (MapKit)" value={settings.googleOnIos} onChange={(v) => onChange({ googleOnIos: v })} />
          )}
        </View>
        <Text style={{ color: t.sub, fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          Kartendaten & Verkehr: Google{Platform.OS === 'ios' && !settings.googleOnIos ? ' · Kartenbild: Apple' : ''}
        </Text>
      </View>
    </Modal>
  );
}

function Row({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {!!sub && <Text style={{ color: t.sub, fontSize: 12 }}>{sub}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700' },
  types: { flexDirection: 'row', gap: 10, marginTop: 16 },
  type: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 2 },
  card: { borderRadius: 12, paddingHorizontal: 14, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
