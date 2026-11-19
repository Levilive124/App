import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme';

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function RoundIcon({ icon, color, bg, size = 34 }: { icon: Icon; color?: string; bg: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={icon} size={size * 0.55} color={color ?? '#fff'} />
    </View>
  );
}

export function ListRow({
  icon, iconBg, title, subtitle, right, onPress, onLongPress,
}: {
  icon: Icon; iconBg: string; title: string; subtitle?: string; right?: React.ReactNode;
  onPress?: () => void; onLongPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <RoundIcon icon={icon} bg={iconBg} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: t.text }]}>{title}</Text>
        {!!subtitle && <Text numberOfLines={2} style={[styles.rowSub, { color: t.sub }]}>{subtitle}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

export function ActionButton({
  icon, label, onPress, primary, style, loading,
}: { icon: Icon; label: string; onPress: () => void; primary?: boolean; style?: ViewStyle; loading?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: primary ? t.accent : t.field, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : t.accent} />
      ) : (
        <MaterialCommunityIcons name={icon} size={22} color={primary ? '#fff' : t.accent} />
      )}
      <Text style={[styles.actionLabel, { color: primary ? '#fff' : t.accent }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.section, { color: t.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={[styles.close, { backgroundColor: t.field }]}>
      <MaterialCommunityIcons name="close" size={18} color={t.sub} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2 },
  action: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', gap: 2 },
  actionLabel: { fontSize: 12, fontWeight: '600' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 18, marginBottom: 6 },
  section: { fontSize: 20, fontWeight: '700' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
