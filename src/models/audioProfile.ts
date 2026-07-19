/**
 * Opetettujen äänten profiilit (äänisormenjäljet).
 *
 * Sovellus vaatii, että lähettäjä opettaa oman pillinsä ja starttipistoolinsa
 * äänet ennen käyttöä. Näin tunnistus perustuu juuri näihin ääniin eikä
 * yleiseen sääntöön, mikä poistaa vääriä osumia (esim. yskäisy ei enää kelpaa
 * pilliksi).
 */

/** Pillin opetettu profiili. */
export interface WhistleProfile {
  /** Opittu hallitseva sävelkorkeus (Hz). */
  centerFreqHz: number;
  /** Hyväksyntäkaista sävelkorkeuden ympärillä (Hz). */
  toleranceHz: number;
  /** Vaadittu voimakkuus taustan yli (dB). */
  minProminenceDb: number;
  /** Vaadittu yhtäjaksoinen kesto (ms). */
  minDurationMs: number;
}

/** Starttipistoolin opetettu profiili. */
export interface GunshotProfile {
  /** Opittu laukauksen huippuvoimakkuus (RMS 0..1). */
  refRms: number;
  /** Energian äkillinen nousukynnys suhteessa taustaan. */
  onsetRatio: number;
}

/** Molemmat profiilit + metatieto. */
export interface AudioProfiles {
  whistle: WhistleProfile | null;
  gunshot: GunshotProfile | null;
  updatedAtEpochMs: number;
}

/** Tyhjä lähtötila (mitään ei vielä opetettu). */
export const EMPTY_PROFILES: AudioProfiles = {
  whistle: null,
  gunshot: null,
  updatedAtEpochMs: 0,
};

/** Onko molemmat äänet opetettu (sovellus käyttövalmis). */
export function isCalibrationComplete(p: AudioProfiles): boolean {
  return p.whistle !== null && p.gunshot !== null;
}
