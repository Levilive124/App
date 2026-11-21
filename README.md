# Lumo

Chat-Plattform für Freunde und Communities – Server, Kanäle, Direktnachrichten, Sprach- und Videochat.
Läuft als Website am PC und auf dem Handy (auch als App auf dem Home-Bildschirm installierbar).
Funktionen, die anderswo ein Abo kosten, sind hier **gratis**.

## Funktionen

| Bereich | Enthalten |
|---|---|
| Konto | Registrierung mit Benutzername, E-Mail und Passwort, **automatische Bestätigungs-Mail**, Anmeldung mit Benutzername *oder* E-Mail, Passwort vergessen (per Mail), E-Mail/Passwort ändern, Abmelden |
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
1. Auf [vercel.com](https://vercel.com/signup) mit GitHub anmelden → **Add New… → Project** → dieses Repository importieren → **Deploy**.
2. Projekt-URL und öffentlicher Schlüssel (`sb_publishable_…`) sind in `src/main.js` fest hinterlegt.
   Optional überschreibbar per Environment Variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (nur beim Bauen, nicht in der App).

### 3. E-Mails (Bestätigung & Passwort vergessen)
1. **Authentication → URL Configuration**: *Site URL* = deine Vercel-Adresse (z. B. `https://lumoapp-teal.vercel.app`).
2. **Authentication → Sign In / Providers → Email**: **„Confirm email“ einschalten**.
3. **Eigener Mail-Versand** (Supabase selbst schickt nur an Team-Mitglieder):
   **Authentication → Emails → SMTP Settings** – z. B. mit einem Gmail-Konto:
   Host `smtp.gmail.com`, Port `465`, Benutzer = Gmail-Adresse, Passwort = **App-Passwort**
   (myaccount.google.com/apppasswords, braucht 2-Schritt-Bestätigung), Absendername `Lumo`.
4. **Authentication → Emails → Templates**: Inhalte aus `supabase/emails/bestaetigung.html`
   („Confirm signup“) und `supabase/emails/passwort.html` („Reset password“) einfügen.

> Der öffentliche Schlüssel darf im Code stehen. Den **service_role / Secret key** niemals verwenden –
> die Daten schützen die Sicherheitsregeln (Row Level Security) im Schema.

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
