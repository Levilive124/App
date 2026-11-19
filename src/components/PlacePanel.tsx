import React from 'react';
import { Image, Linking, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Place } from '../api/google';
import { useTheme } from '../theme';
import { distance, type LatLng } from '../utils/geo';
import { formatDistance } from '../utils/format';
import { ActionButton, CloseButton, ListRow } from './ui';

export function PlaceHeader({ place, near, onClose }: { place: Place; near: LatLng | null; onClose: () => void }) {
  const t = useTheme();
  const meta = [place.category, near ? formatDistance(distance(near, place.location)) : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>{place.name}</Text>
        {!!meta && <Text style={{ color: t.sub, fontSize: 15, marginTop: 2 }}>{meta}</Text>}
      </View>
      <CloseButton onPress={onClose} />
    </View>
  );
}

export function PlaceBody({
  place, isFavorite, onRoute, onToggleFavorite, routeLoading, etaText,
}: {
  place: Place; isFavorite: boolean; onRoute: () => void; onToggleFavorite: () => void; routeLoading: boolean; etaText?: string;
}) {
  const t = useTheme();
  const stars = place.rating != null ? '★'.repeat(Math.round(place.rating)) + '☆'.repeat(5 - Math.round(place.rating)) : null;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.actions}>
        <ActionButton icon="car" label={etaText ?? 'Route'} primary onPress={onRoute} loading={routeLoading} />
        {!!place.phone && <ActionButton icon="phone" label="Anrufen" onPress={() => Linking.openURL(`tel:${place.phone!.replace(/\s/g, '')}`)} />}
        {!!place.website && <ActionButton icon="web" label="Website" onPress={() => Linking.openURL(place.website!)} />}
        <ActionButton icon={isFavorite ? 'star' : 'star-outline'} label={isFavorite ? 'Gesichert' : 'Sichern'} onPress={onToggleFavorite} />
        <ActionButton
          icon="share-variant"
          label="Teilen"
          onPress={() =>
            Share.share({
              message: `${place.name}\n${place.address}\nhttps://www.google.com/maps/search/?api=1&query=${place.location.latitude},${place.location.longitude}${place.id ? `&query_place_id=${place.id}` : ''}`,
            })
          }
        />
      </View>

      <View style={[styles.stats, { borderColor: t.border }]}>
        {place.openNow != null && (
          <Stat label="Öffnungszeiten" value={place.openNow ? 'Geöffnet' : 'Geschlossen'} color={place.openNow ? t.green : t.red} />
        )}
        {place.rating != null && <Stat label={`${place.ratingCount ?? 0} Bewertungen`} value={`${place.rating.toFixed(1)} ${stars}`} color={t.orange} />}
        {!!place.priceLevel && <Stat label="Preis" value={priceLabel(place.priceLevel)} color={t.text} />}
      </View>

      {!!place.photo && <Image source={{ uri: place.photo }} style={styles.photo} resizeMode="cover" />}

      <View style={[styles.card, { backgroundColor: t.card }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Details</Text>
        {!!place.address && <Detail label="Adresse" value={place.address} />}
        {!!place.phone && <Detail label="Telefon" value={place.phone} link={`tel:${place.phone.replace(/\s/g, '')}`} />}
        {!!place.website && <Detail label="Website" value={place.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} link={place.website} />}
        <Detail label="Koordinaten" value={`${place.location.latitude.toFixed(5)}° N, ${place.location.longitude.toFixed(5)}° E`} />
        {place.hours?.map((h) => (
          <Text key={h} style={{ color: t.sub, fontSize: 14, marginTop: 4 }}>{h}</Text>
        ))}
      </View>

      <ListRow
        icon="google-street-view"
        iconBg="#FF9500"
        title="Umgebung ansehen (Street View)"
        onPress={() =>
          Linking.openURL(
            `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${place.location.latitude},${place.location.longitude}`,
          )
        }
      />
      <ListRow
        icon="open-in-new"
        iconBg="#8E8E93"
        title={Platform.OS === 'ios' ? 'In anderer App öffnen' : 'In Google Maps öffnen'}
        onPress={() =>
          Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${place.location.latitude},${place.location.longitude}`)
        }
      />
    </ScrollView>
  );
}

function priceLabel(p: string) {
  return { PRICE_LEVEL_FREE: 'Kostenlos', PRICE_LEVEL_INEXPENSIVE: '€', PRICE_LEVEL_MODERATE: '€€', PRICE_LEVEL_EXPENSIVE: '€€€', PRICE_LEVEL_VERY_EXPENSIVE: '€€€€' }[p] ?? '';
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: 8 }}>
      <Text style={{ color: t.sub, fontSize: 12 }} numberOfLines={1}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Detail({ label, value, link }: { label: string; value: string; link?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: t.sub, fontSize: 13 }}>{label}</Text>
      <Text onPress={link ? () => Linking.openURL(link) : undefined} style={{ color: link ? t.accent : t.text, fontSize: 15, marginTop: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export function ResultsHeader({ query, count, onClose }: { query: string; count: number; onClose: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{query}</Text>
        <Text style={{ color: t.sub, fontSize: 15 }}>{count} Ergebnisse</Text>
      </View>
      <CloseButton onPress={onClose} />
    </View>
  );
}

export function ResultsList({ places, near, onSelect }: { places: Place[]; near: LatLng | null; onSelect: (p: Place) => void }) {
  const t = useTheme();
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      {places.map((pl) => (
        <ListRow
          key={pl.id}
          icon="map-marker"
          iconBg={t.red}
          title={pl.name}
          subtitle={[
            pl.category,
            near ? formatDistance(distance(near, pl.location)) : null,
            pl.rating != null ? `★ ${pl.rating.toFixed(1)}` : null,
            pl.openNow == null ? null : pl.openNow ? 'Geöffnet' : 'Geschlossen',
          ].filter(Boolean).join(' · ')}
          onPress={() => onSelect(pl)}
        />
      ))}
      {places.length === 0 && <Text style={{ color: t.sub, padding: 16 }}>Keine Ergebnisse gefunden.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  stats: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  photo: { height: 180, marginHorizontal: 16, marginTop: 16, borderRadius: 12 },
  card: { margin: 16, padding: 16, borderRadius: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
});
