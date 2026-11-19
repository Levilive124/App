import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme';

type Props = {
  top: number;
  following: boolean;
  traffic: boolean;
  incidents: boolean;
  threeD: boolean;
  onLayers: () => void;
  onLocate: () => void;
  onToggleTraffic: () => void;
  onToggleIncidents: () => void;
  onToggle3D: () => void;
};

export function MapControls(p: Props) {
  const t = useTheme();
  const Btn = ({ icon, onPress, active }: { icon: any; onPress: () => void; active?: boolean }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]} hitSlop={4}>
      <MaterialCommunityIcons name={icon} size={22} color={active ? t.accent : t.sub} />
    </Pressable>
  );
  const Sep = () => <View style={[styles.sep, { backgroundColor: t.border }]} />;
  return (
    <View style={[styles.wrap, { top: p.top }]}>
      <View style={[styles.group, { backgroundColor: t.sheet, shadowColor: t.shadow }]}>
        <Btn icon="layers-outline" onPress={p.onLayers} active />
        <Sep />
        <Btn icon={p.following ? 'navigation' : 'navigation-outline'} onPress={p.onLocate} active />
      </View>
      <View style={[styles.group, { backgroundColor: t.sheet, shadowColor: t.shadow, marginTop: 10 }]}>
        <Btn icon="traffic-light" onPress={p.onToggleTraffic} active={p.traffic} />
        <Sep />
        <Btn icon="car-brake-alert" onPress={p.onToggleIncidents} active={p.incidents} />
        <Sep />
        <Btn icon={p.threeD ? 'cube-outline' : 'square-outline'} onPress={p.onToggle3D} active={p.threeD} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 10 },
  group: { borderRadius: 10, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 4 },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: 6 },
});
