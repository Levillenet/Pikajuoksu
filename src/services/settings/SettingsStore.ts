import type { DeviceRole } from '@/models/nearby';
import { createLogger } from '@/utils/logger';

const log = createLogger('SettingsStore');
const ROLE_KEY = 'pikajuoksu.deviceRole.v1';

/**
 * SettingsStore säilyttää sovelluksen pysyvät asetukset (localStorage).
 * Tällä hetkellä: laitteen rooli (Camera/Viewer) lähiyhteyttä varten.
 * Rooli säilyy uudelleenkäynnistyksen yli ja luetaan käynnistyksessä.
 */
export class SettingsStore {
  private roleCache: DeviceRole | null | undefined;

  /** Palauttaa valitun roolin, tai null jos ei vielä valittu. */
  getRole(): DeviceRole | null {
    if (this.roleCache !== undefined) return this.roleCache;
    try {
      const raw = localStorage.getItem(ROLE_KEY);
      this.roleCache = raw === 'camera' || raw === 'viewer' ? raw : null;
    } catch (err) {
      log.warn('Roolin luku epäonnistui', err);
      this.roleCache = null;
    }
    return this.roleCache;
  }

  /** Asettaa roolin ja tallentaa sen pysyvästi. */
  setRole(role: DeviceRole): void {
    this.roleCache = role;
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch (err) {
      log.error('Roolin tallennus epäonnistui', err);
    }
  }
}
