/**
 * Aikaan liittyvät apufunktiot. Tarkkuus on kriittistä varaslähtöanalyysissä,
 * jossa käsitellään millisekunteja.
 */

/** Muotoilee millisekunnit muotoon mm:ss (esim. videon pituus). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Muotoilee reaktioajan/poikkeaman etumerkillä, esim. "-35 ms" tai "+164 ms". */
export function formatSignedMs(ms: number): string {
  const rounded = Math.round(ms);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded} ms`;
}

/** Muotoilee päivämäärän suomalaiseen muotoon: 18.7.2026. */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Muotoilee kellonajan: 14:05. */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

/**
 * Palauttaa monotonisen aikaleiman (ei riipu kellon säädöistä).
 * Käytetään ääni- ja videotapahtumien synkronointiin.
 */
export function nowMonotonic(): number {
  return performance.now();
}
