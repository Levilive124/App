export function formatDistance(m: number): string {
  if (m < 50) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

export function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 1) return '< 1 Min.';
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Parses Google duration strings like "1234s". */
export function parseSeconds(d?: string): number {
  if (!d) return 0;
  return parseFloat(d.replace('s', '')) || 0;
}
