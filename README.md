# Einsatzzentrale

Ein Leitstellen-Spiel für das iPhone (Web-App im Liquid-Glass-Design). Du baust Wachen auf einer
echten Karte, kaufst Fahrzeuge und disponierst eingehende Notrufe.

**Spielen:** https://levilive124.github.io/App/ – in Safari öffnen → Teilen → *Zum Home-Bildschirm*.

## Spielablauf
1. Startort wählen (eigener Standort oder Stadt suchen).
2. Erste Feuerwache bauen (gratis) – jede Wache bringt ein Fahrzeug mit.
3. Notrufe erscheinen auf der Karte. Einsatz antippen → **Vorschlag** wählt die nächsten passenden
   Fahrzeuge → **Alarmieren**.
4. Fahrzeuge fahren auf echten Straßen hin (Status 3), arbeiten vor Ort (Status 4), bringen Patienten
   ins Krankenhaus (Status 7/8) und fahren zurück (Status 1 → 2).
5. Credits verdienen, Level aufsteigen, neue Wachen, Fahrzeuge und größere Einsätze freischalten.

Inhalt: 4 Gebäudetypen, 11 Fahrzeugtypen, 33 Einsatzarten (Feuerwehr, Rettungsdienst, Polizei),
Spielgeschwindigkeit 1×/2×/5×, Pause, Töne, automatisches Speichern auf dem Gerät.

## Technik
Reines HTML/CSS/JavaScript im Ordner `docs/`, ausgeliefert über GitHub Pages (Branch `gh-pages`).
Kostenlose Dienste ohne Schlüssel: Karte OpenFreeMap/OpenStreetMap (MapLibre GL), Routen OSRM
(routing.openstreetmap.de), Adressen Photon.

| Datei | Inhalt |
|---|---|
| `docs/game.js` | Spiellogik, Karte, Oberfläche |
| `docs/data.js` | Fahrzeuge, Gebäude, Einsätze |
| `docs/style.css` | Liquid-Glass-Design |

Die frühere Karten-App ist in der Git-Historie erhalten (Commit `2b261b4`).
