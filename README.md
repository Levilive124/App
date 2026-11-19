# Karten – Karten- & Navigations-App mit Live-Verkehr

Eine Handy-App (iOS & Android, Expo / React Native) im Stil der großen Karten-Apps:
Vollbildkarte, Suche im Bottom-Sheet, Ortsdetails, Routenplanung mit Alternativen und
Turn-by-Turn-Navigation mit Sprachansagen. **Verkehrsstörungen (Staus, stockender Verkehr)
werden live über die Google APIs geladen.**

## Funktionen

| Bereich | Was drin ist |
|---|---|
| Karte | Apple Karten (MapKit) auf iOS, Google Maps auf Android (optional Google auch auf iOS), Standard / Hybrid / Satellit / Gelände, 3D-Gebäude & Neigung, Dark-Mode, Kompass, Maßstab |
| Live-Verkehr | Verkehrsfluss-Ebene (grün/orange/rot), Route selbst nach Verkehr eingefärbt |
| **Verkehrsstörungen** | Stau-Marker auf der Karte mit Verzögerung, Liste „Verkehrslage“ für den sichtbaren Bereich, Störungen auf der Route, Detailansicht (Länge, Verzögerung, Ø-Tempo, Richtung, Straße) |
| Suche | Google Places Autocomplete, Textsuche, Kategorien (Tankstellen, Laden, Restaurants, Parken …), Verlauf |
| Orte | Fotos, Bewertung, Öffnungszeiten, Telefon, Website, Teilen, Street View, Pin per Long-Press |
| Favoriten | Zuhause, Arbeit (ein Tipp = Route), beliebige Favoriten (lange drücken = entfernen) |
| Routen | Auto, ÖPNV (Linien, Abfahrten, Haltestellen), zu Fuß, Fahrrad, Motorrad; Alternativen; Maut/Autobahn/Fähren vermeiden; Ankunftszeit inkl. Verkehr |
| Navigation | Manöver-Banner, „Dann …“-Vorschau, Sprachansagen (Deutsch), Stau-Warnung voraus, automatische Neuberechnung bei Abweichung, Verkehrs-Update alle 2 Min., Display bleibt an |

## Woher kommen die Verkehrsstörungen?

Google bietet keine öffentliche „Incident“-Liste an. Die App nutzt deshalb die
**Google Routes API** (`computeRoutes` mit `TRAFFIC_AWARE_OPTIMAL` und
`extraComputations: TRAFFIC_ON_POLYLINE`). Jede Antwort enthält `speedReadingIntervals`,
die zeigen, wo auf der Strecke gerade `SLOW` oder `TRAFFIC_JAM` herrscht. Daraus macht
`src/traffic/incidents.ts`:

1. **Auf deiner Route:** zusammenhängende Stau-Abschnitte → Position, Länge, Entfernung,
   geschätzte Verzögerung (Gesamtverzögerung `duration − staticDuration`, gewichtet verteilt).
2. **In der Umgebung:** Für den sichtbaren Kartenausschnitt werden 16 Testrouten
   (8 Himmelsrichtungen, jeweils hin und zurück) abgefragt; Störungen werden zusammengeführt
   und dedupliziert. Ergebnis wird 3 Minuten gecacht.
3. **Straßennamen** kommen über die Geocoding API.

Zusätzlich zeigt die Karte Googles Live-Verkehrsebene (`showsTraffic`).

## Einrichtung

### 1. Google API-Schlüssel

In der [Google Cloud Console](https://console.cloud.google.com/google/maps-apis) ein Projekt
anlegen, Abrechnung aktivieren und diese APIs einschalten:

- Maps SDK for Android (und Maps SDK for iOS, falls Google auch auf iOS genutzt wird)
- Places API (New)
- Routes API
- Geocoding API

```bash
cp .env.example .env
# GOOGLE_MAPS_API_KEY=AIza... eintragen
```

> **Tipp:** Schlüssel in der Console auf die App einschränken (Android: Paketname
> `com.levilive.karten` + SHA-1, iOS: Bundle-ID). Die App sendet die passenden
> `X-Android-Package`/`X-Ios-Bundle-Identifier`-Header mit; für Android den SHA-1 in
> `ANDROID_CERT_SHA1` eintragen.

**Kosten:** Die Umgebungs-Verkehrsabfrage kostet pro Scan bis zu 16 Routes-API-Anfragen.
Sie startet nur bei aktivierten „Verkehrsstörungen“ und ausreichend Zoom und wird gecacht.
Über den Stau-Button rechts lässt sie sich abschalten.

### 2. Starten

```bash
npm install
npx expo run:android      # oder: npx expo run:ios
```

Weil `react-native-maps` mit Google-Schlüssel nativen Code braucht, läuft die App als
**Development Build** (nicht in Expo Go). Ohne lokales Xcode/Android Studio per EAS:

```bash
npx eas-cli@latest build --profile development --platform android   # bzw. ios
npx expo start --dev-client
```

Installierbare Test-APK: `npx eas-cli@latest build --profile preview --platform android`.

## Projektstruktur

```
App.tsx                      Karte, Zustände, Kamera, Bottom-Sheet-Inhalte
src/api/google.ts            Places (New), Routes API, Geocoding
src/traffic/incidents.ts     Stau-Erkennung aus speedReadingIntervals, Umgebungs-Scan
src/hooks/useNavigation.ts   Turn-by-Turn-Logik, Sprachansagen, Neuberechnung
src/hooks/useLocation.ts     GPS
src/components/              BottomSheet, Suche, Ort, Route, Navigation, Ebenen, Störung
src/utils/                   Geo-Mathe, Polyline-Decoder, Formatierung, Manöver-Icons
```
