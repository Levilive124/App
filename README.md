# Lumo

Chat-Plattform für Freunde und Communities – Server, Kanäle, Direktnachrichten, Sprach- und Videochat.
Läuft als Website am PC und auf dem Handy (auch als App auf dem Home-Bildschirm installierbar).
Funktionen, die anderswo ein Abo kosten, sind hier **gratis**.

## Funktionen

| Bereich | Enthalten |
|---|---|
| Konto | Registrierung und Anmeldung nur mit **Benutzername + Passwort** (keine E-Mail, keine Bestätigung), Passwort ändern, Abmelden |
| Profil | Anzeigename, Benutzername, „Über mich“ (Markdown), Profilfarbe, **Profilbild & Banner (auch animierte GIFs)**, Status (Online/Abwesend/Bitte nicht stören/Unsichtbar), eigener Statustext |
| Freunde | Anfragen senden/annehmen/ablehnen, Online-/Alle-/Ausstehend-Listen, Profilkarten mit gemeinsamen Servern |
| Server | Erstellen (Name, Farbe, Bild), Einladungslinks & Codes (mit Vorschau), neuen Link erzeugen, Beitreten, Verlassen, Löschen |
| Rollen | Besitzer, Admins, Mitglieder – Admins ernennen, Mitglieder entfernen |
| Kanäle | Text- und Sprachkanäle anlegen, umbenennen, Thema setzen, löschen |
| Nachrichten | Echtzeit, Antworten, Bearbeiten, Löschen, Reaktionen (Emoji-Auswahl), Anheften, Suche, @Erwähnungen (+ @everyone), Markdown (fett, kursiv, unterstrichen, durchgestrichen, Code, Codeblöcke, Zitate, Spoiler), Links, Emoji-only groß |
| Dateien | Bilder, Videos, Audio, beliebige Dateien **bis 50 MB**, Einfügen aus Zwischenablage, Drag & Drop, Bildvorschau/Lightbox |
| Extras | **Umfragen**, Tipp-Anzeige („… schreibt“), ungelesen-Markierungen & Erwähnungs-Zähler, Entwürfe pro Kanal, Schnellsuche (Strg+K) |
| Sprache & Video | Sprachkanäle mit Sprecher-Anzeige, Stummschalten, Ton aus, **Kamera und Bildschirm teilen in voller Qualität (1080p, bis 60 fps)** |
| Darstellung | Liquid-Glass-Design, Hell/Dunkel/Automatisch, kompakte Ansicht, Schriftgröße, eigene Handy- und PC-Oberfläche |
| Benachrichtigungen | Töne bei Erwähnungen & DMs, Systembenachrichtigungen, App-Badge |

## Einrichtung (einmalig, alles im Browser – auch am Handy möglich)

### 1. Datenbank: Supabase (kostenlos)
1. Auf [supabase.com](https://supabase.com/dashboard/sign-up) ein Konto anlegen → **New project** (Region Frankfurt).
2. Links **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Project Settings → API**: *Project URL* und *anon public* Schlüssel notieren.

### 2. Website: Vercel (kostenlos)
1. Auf [vercel.com](https://vercel.com/signup) mit GitHub anmelden → **Add New… → Project** → dieses Repository importieren.
2. Bei **Environment Variables** eintragen:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public Schlüssel
3. **Deploy** – fertig. Jeder neue Commit wird automatisch veröffentlicht.

### 3. E-Mail-Bestätigung ausschalten
**Authentication → Sign In / Providers → Email**: **„Confirm email“ ausschalten** → Save.
Lumo nutzt nur Benutzername + Passwort; intern bekommt jedes Konto eine Platzhalter-Adresse
(`…@lumoapp.vercel.app`), an die nie etwas gesendet wird.

> Den **service_role**-Schlüssel niemals eintragen. Der anon-Schlüssel ist öffentlich; die Daten schützen die
> Sicherheitsregeln (Row Level Security) im Schema.

## Entwicklung
```bash
npm install
cp .env.example .env   # Werte eintragen
npm run dev
```
`npm run build` erzeugt die Website in `dist/` (genau das macht Vercel).

## Aufbau
```
index.html            Seitengerüst
src/main.js           App (Anmeldung, Server, Kanäle, Chat, Freunde, Sprache/Video, Einstellungen)
src/style.css         Liquid-Glass-Design (Handy + PC)
supabase/schema.sql   Datenbank, Sicherheitsregeln, Funktionen, Datei-Speicher, Echtzeit
public/               Icons, Manifest
tests/                Test-Ersatz für Supabase (nur für automatische Tests)
```

## Geplant
Threads & Foren, eigene Rollen mit Rechten, Server-Emojis & Sticker, Bots/Webhooks, Events,
Push-Benachrichtigungen bei geschlossener App, TURN-Server für schwierige Netze, größere Sprachräume.
