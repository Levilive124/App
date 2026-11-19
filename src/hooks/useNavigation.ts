import { useEffect, useMemo, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import type { Route } from '../api/google';
import type { Incident } from '../traffic/incidents';
import { pathLength, snapToPath } from '../utils/geo';
import type { Fix } from './useLocation';

export type NavState = {
  stepIndex: number;
  distToManeuver: number;
  remainingMeters: number;
  remainingSec: number;
  offRoute: boolean;
  arrived: boolean;
  nextIncident: { incident: Incident; distance: number } | null;
  snapped: { latitude: number; longitude: number } | null;
};

const TRAFFIC_REFRESH_MS = 2 * 60 * 1000;

function spokenDistance(m: number) {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toString().replace('.', ',')} Kilometern`;
  return `${Math.round(m / 50) * 50 || 50} Metern`;
}

export function useNavigation(
  route: Route | null,
  incidents: Incident[],
  fix: Fix | null,
  active: boolean,
  voice: boolean,
  onReroute: (reason: 'offroute' | 'traffic') => void,
) {
  const [state, setState] = useState<NavState | null>(null);
  const announced = useRef(new Set<string>());
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const rerouteRef = useRef(onReroute);
  rerouteRef.current = onReroute;

  const stepEnds = useMemo(() => {
    let acc = 0;
    return (route?.steps ?? []).map((s) => (acc += s.distanceMeters));
  }, [route]);

  const geomTotal = useMemo(() => (route ? pathLength(route.points) : 1) || 1, [route]);

  const say = (key: string, text: string) => {
    if (!voice || announced.current.has(key)) return;
    announced.current.add(key);
    Speech.stop();
    Speech.speak(text, { language: 'de-DE', rate: 1.0 });
  };

  // reset announcements for a fresh route
  useEffect(() => {
    announced.current = new Set();
    offCount.current = 0;
  }, [route?.id]);

  useEffect(() => {
    if (!active) {
      setState(null);
      Speech.stop();
      return;
    }
    const id = setInterval(() => {
      if (Date.now() - lastReroute.current > TRAFFIC_REFRESH_MS) {
        lastReroute.current = Date.now();
        rerouteRef.current('traffic');
      }
    }, 15000);
    lastReroute.current = Date.now();
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active || !route || !fix || route.points.length < 2) return;
    const total = route.distanceMeters || stepEnds[stepEnds.length - 1] || 1;
    const snap = snapToPath(fix, route.points);
    // scale the geometric distance to Google's reported distance
    const along = (snap.along / geomTotal) * total;
    const remaining = Math.max(0, total - along);

    let stepIndex = stepEnds.findIndex((e) => e > along);
    if (stepIndex < 0) stepIndex = Math.max(0, stepEnds.length - 1);
    const distToManeuver = Math.max(0, (stepEnds[stepIndex] ?? total) - along);

    const tolerance = Math.max(45, (fix.accuracy ?? 20) * 1.5);
    offCount.current = snap.offset > tolerance ? offCount.current + 1 : 0;
    const offRoute = offCount.current >= 3;
    if (offRoute && Date.now() - lastReroute.current > 12000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      if (voice) Speech.speak('Route wird neu berechnet.', { language: 'de-DE' });
      rerouteRef.current('offroute');
    }

    const next = route.steps[stepIndex + 1];
    const arrived = remaining < 25;
    const isWalk = route.mode === 'WALK';
    if (arrived) say('arrived', 'Sie haben Ihr Ziel erreicht.');
    else if (stepIndex === 0 && along < 30 && route.steps[0]) say('start', route.steps[0].instruction || 'Route wird gestartet.');
    if (next && !arrived) {
      const thresholds = isWalk ? [60, 15] : (fix.speed ?? 0) > 22 ? [2000, 800, 120] : [500, 150, 30];
      for (const th of thresholds) {
        if (distToManeuver <= th && distToManeuver > th * 0.4) {
          const text = th <= 30 ? next.instruction : `In ${spokenDistance(distToManeuver)}: ${next.instruction}`;
          say(`${route.id}-${stepIndex}-${th}`, text);
          break;
        }
      }
    }

    const ahead = incidents
      .filter((i) => i.atMeters != null && i.atMeters + i.lengthMeters > along)
      .sort((a, b) => a.atMeters! - b.atMeters!)[0];
    const nextIncident = ahead ? { incident: ahead, distance: Math.max(0, ahead.atMeters! - along) } : null;
    if (nextIncident && nextIncident.distance < 3000 && nextIncident.distance > 100) {
      say(
        `inc-${nextIncident.incident.id}`,
        `Achtung, ${nextIncident.incident.kind === 'JAM' ? 'Stau' : 'stockender Verkehr'} in ${spokenDistance(nextIncident.distance)}` +
          (nextIncident.incident.road ? ` auf ${nextIncident.incident.road}.` : '.'),
      );
    }

    setState({
      stepIndex,
      distToManeuver,
      remainingMeters: remaining,
      remainingSec: route.durationSec * (remaining / total),
      offRoute,
      arrived,
      nextIncident,
      snapped: snap.offset < tolerance ? snap.point : null,
    });
  }, [fix, route, active, incidents]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

