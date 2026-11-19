import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { autocomplete, searchText, type Place, type Suggestion } from '../api/google';
import { incidentTitle, type Incident } from '../traffic/incidents';
import type { SavedPlace } from '../storage';
import { useTheme } from '../theme';
import { distance, type LatLng } from '../utils/geo';
import { formatDistance, formatDuration } from '../utils/format';
import { ListRow, SectionTitle } from './ui';

const CATEGORIES: { label: string; query: string; icon: any; color: string }[] = [
  { label: 'Tankstellen', query: 'Tankstelle', icon: 'gas-station', color: '#0A84FF' },
  { label: 'Laden', query: 'Ladestation Elektroauto', icon: 'ev-station', color: '#30B0C7' },
  { label: 'Restaurants', query: 'Restaurant', icon: 'silverware-fork-knife', color: '#FF9500' },
  { label: 'Parken', query: 'Parkplatz', icon: 'parking', color: '#5856D6' },
  { label: 'Supermarkt', query: 'Supermarkt', icon: 'cart', color: '#34C759' },
  { label: 'Café', query: 'Café', icon: 'coffee', color: '#A2845E' },
  { label: 'Apotheke', query: 'Apotheke', icon: 'medical-bag', color: '#FF3B30' },
  { label: 'Hotels', query: 'Hotel', icon: 'bed', color: '#AF52DE' },
];

type Props = {
  near: LatLng | null;
  favorites: SavedPlace[];
  recents: SavedPlace[];
  incidents: Incident[];
  incidentsLoading: boolean;
  onFocus: () => void;
  onSuggestion: (s: Suggestion, sessionToken: string) => void;
  onResults: (query: string, places: Place[]) => void;
  onSaved: (p: SavedPlace) => void;
  onRemoveSaved: (p: SavedPlace) => void;
  onIncident: (i: Incident) => void;
  onRefreshIncidents: () => void;
  onSetHomeWork: (kind: 'home' | 'work') => void;
  error?: string | null;
};

const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function SearchHeader({ value, onChange, onFocus, onCancel, focused, loading }: {
  value: string; onChange: (s: string) => void; onFocus: () => void; onCancel: () => void; focused: boolean; loading: boolean;
}) {
  const t = useTheme();
  return (
    <View style={styles.headerRow}>
      <View style={[styles.search, { backgroundColor: t.field }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={t.sub} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          placeholder="Suche nach Orten und Adressen"
          placeholderTextColor={t.sub}
          style={[styles.input, { color: t.text }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {loading ? <ActivityIndicator size="small" /> : !!value && (
          <Pressable onPress={() => onChange('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color={t.sub} />
          </Pressable>
        )}
      </View>
      {focused && (
        <Pressable onPress={onCancel} style={{ paddingLeft: 12 }}>
          <Text style={{ color: t.accent, fontSize: 16 }}>Abbrechen</Text>
        </Pressable>
      )}
    </View>
  );
}

export function SearchPanel(p: Props & { query: string; setQuery: (s: string) => void; focused: boolean; setLoading: (b: boolean) => void }) {
  const t = useTheme();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const token = useRef(newToken());
  const seq = useRef(0);

  useEffect(() => {
    const q = p.query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      p.setLoading(true);
      try {
        const res = await autocomplete(q, p.near, token.current);
        if (id === seq.current) setSuggestions(res);
      } catch {
        if (id === seq.current) setSuggestions([]);
      } finally {
        if (id === seq.current) p.setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [p.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async (query: string) => {
    Keyboard.dismiss();
    p.setLoading(true);
    try {
      p.onResults(query, await searchText(query, p.near));
    } catch {
      p.onResults(query, []);
    } finally {
      p.setLoading(false);
    }
  };

  const home = p.favorites.find((f) => f.kind === 'home');
  const work = p.favorites.find((f) => f.kind === 'work');
  const others = p.favorites.filter((f) => f.kind === 'favorite');

  if (p.query.trim().length >= 2) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {suggestions.map((s, i) => (
          <ListRow
            key={`${s.placeId ?? s.query}-${i}`}
            icon={s.placeId ? 'map-marker' : 'magnify'}
            iconBg={s.placeId ? t.red : '#8E8E93'}
            title={s.title}
            subtitle={[s.distanceMeters != null ? formatDistance(s.distanceMeters) : null, s.subtitle].filter(Boolean).join(' · ')}
            onPress={() => {
              Keyboard.dismiss();
              if (s.placeId) {
                p.onSuggestion(s, token.current);
                token.current = newToken();
              } else runSearch(s.query ?? s.title);
            }}
          />
        ))}
        <ListRow icon="magnify" iconBg="#8E8E93" title={`„${p.query.trim()}“ suchen`} onPress={() => runSearch(p.query.trim())} />
      </ScrollView>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
      {!!p.error && (
        <View style={[styles.banner, { backgroundColor: t.field }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={t.orange} />
          <Text style={{ color: t.text, flex: 1, marginLeft: 8, fontSize: 13 }}>{p.error}</Text>
        </View>
      )}

      <SectionTitle>Favoriten</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}>
        <FavBubble icon="home" color="#0A84FF" label="Zuhause" sub={home ? 'Route' : 'Hinzufügen'} onPress={() => (home ? p.onSaved(home) : p.onSetHomeWork('home'))} />
        <FavBubble icon="briefcase" color="#A2845E" label="Arbeit" sub={work ? 'Route' : 'Hinzufügen'} onPress={() => (work ? p.onSaved(work) : p.onSetHomeWork('work'))} />
        {others.map((f) => (
          <FavBubble key={f.id} icon="star" color="#FFCC00" label={f.name} sub={p.near ? formatDistance(distance(p.near, f.location)) : ''} onPress={() => p.onSaved(f)} onLongPress={() => p.onRemoveSaved(f)} />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 14, gap: 8 }}>
        {CATEGORIES.map((c) => (
          <Pressable key={c.label} onPress={() => { p.setQuery(''); runSearch(c.query); }} style={[styles.chip, { backgroundColor: t.card }]}>
            <MaterialCommunityIcons name={c.icon} size={16} color={c.color} />
            <Text style={{ color: t.text, fontWeight: '600', marginLeft: 6 }}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <SectionTitle
        right={
          p.incidentsLoading ? <ActivityIndicator size="small" /> : (
            <Pressable onPress={p.onRefreshIncidents} hitSlop={8}>
              <MaterialCommunityIcons name="refresh" size={20} color={t.accent} />
            </Pressable>
          )
        }
      >
        Verkehrslage
      </SectionTitle>
      {p.incidents.length === 0 && !p.incidentsLoading && (
        <Text style={[styles.empty, { color: t.sub }]}>Keine Störungen im sichtbaren Bereich erkannt.</Text>
      )}
      {p.incidents.slice(0, 8).map((inc) => (
        <ListRow
          key={inc.id}
          icon={inc.kind === 'JAM' ? 'car-brake-alert' : 'car-multiple'}
          iconBg={inc.kind === 'JAM' ? t.red : t.orange}
          title={incidentTitle(inc)}
          subtitle={`${formatDistance(inc.lengthMeters)} · ca. +${formatDuration(inc.delaySec)}${p.near ? ` · ${formatDistance(distance(p.near, inc.position))} entfernt` : ''}`}
          onPress={() => p.onIncident(inc)}
        />
      ))}

      {p.recents.length > 0 && <SectionTitle>Zuletzt gesucht</SectionTitle>}
      {p.recents.map((r) => (
        <ListRow key={r.id} icon="clock-outline" iconBg="#8E8E93" title={r.name} subtitle={r.address} onPress={() => p.onSaved(r)} />
      ))}
    </ScrollView>
  );
}

function FavBubble({ icon, color, label, sub, onPress, onLongPress }: { icon: any; color: string; label: string; sub: string; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.fav}>
      <View style={[styles.favIcon, { backgroundColor: t.card }]}>
        <MaterialCommunityIcons name={icon} size={26} color={color} />
      </View>
      <Text numberOfLines={1} style={{ color: t.text, fontWeight: '600', fontSize: 13, marginTop: 6 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12 }}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 11, paddingHorizontal: 10, height: 40, gap: 6 },
  input: { flex: 1, fontSize: 17, paddingVertical: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  fav: { width: 78, alignItems: 'center', marginHorizontal: 4 },
  favIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingHorizontal: 16, fontSize: 14 },
  banner: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 0, padding: 12, borderRadius: 12 },
});
