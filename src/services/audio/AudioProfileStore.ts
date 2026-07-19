import { EMPTY_PROFILES, isCalibrationComplete, type AudioProfiles, type GunshotProfile, type WhistleProfile } from '@/models/audioProfile';
import { createLogger } from '@/utils/logger';

const log = createLogger('AudioProfileStore');
const STORAGE_KEY = 'pikajuoksu.audioProfiles.v1';

/**
 * AudioProfileStore säilyttää opetetut ääniprofiilit laitteessa
 * (localStorage). Käytämme synkronista tallennusta, jotta etusivu voi heti
 * tarkistaa, onko sovellus opetettu ja käyttövalmis.
 */
export class AudioProfileStore {
  private cache: AudioProfiles | null = null;

  /** Lukee profiilit (välimuistista tai levyltä). */
  get(): AudioProfiles {
    if (this.cache) return this.cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.cache = raw ? (JSON.parse(raw) as AudioProfiles) : { ...EMPTY_PROFILES };
    } catch (err) {
      log.warn('Profiilien luku epäonnistui', err);
      this.cache = { ...EMPTY_PROFILES };
    }
    return this.cache;
  }

  /** Tallentaa opetetun pilliprofiilin. */
  saveWhistle(profile: WhistleProfile): void {
    const next = { ...this.get(), whistle: profile, updatedAtEpochMs: Date.now() };
    this.persist(next);
  }

  /** Tallentaa opetetun pistooliprofiilin. */
  saveGunshot(profile: GunshotProfile): void {
    const next = { ...this.get(), gunshot: profile, updatedAtEpochMs: Date.now() };
    this.persist(next);
  }

  /** Tyhjentää opetukset (esim. uudelleenopetusta varten). */
  clear(): void {
    this.persist({ ...EMPTY_PROFILES });
  }

  /** Onko sovellus opetettu ja käyttövalmis. */
  isComplete(): boolean {
    return isCalibrationComplete(this.get());
  }

  private persist(profiles: AudioProfiles): void {
    this.cache = profiles;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (err) {
      log.error('Profiilien tallennus epäonnistui', err);
    }
  }
}
