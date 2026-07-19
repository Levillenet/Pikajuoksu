import type { GunshotProfile, WhistleProfile } from '@/models/audioProfile';
import type { ServiceContainer } from '@/services/container';
import { Observable } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';

const log = createLogger('CalibrationViewModel');

/** Yksittäisen äänen opetuksen tila. */
export type LearnStatus = 'idle' | 'recording' | 'done' | 'error';

export interface CalibrationState {
  /** Pillin opetuksen tila. */
  whistleStatus: LearnStatus;
  /** Pistoolin opetuksen tila. */
  gunshotStatus: LearnStatus;
  /** Opittu pillin sävelkorkeus (näytetään käyttäjälle). */
  whistleFreqHz: number | null;
  /** Opittu laukauksen voimakkuus (0..1). */
  gunshotLevel: number | null;
  /** Laskuri opetuksen aikana (ms jäljellä). */
  countdownMs: number;
  /** Reaaliaikainen mikrofonitaso 0..1 opetuksen aikana (näkyvä palaute). */
  liveLevel: number;
  /** Reaaliaikainen kuultu taajuus (Hz) opetuksen aikana. */
  liveFreqHz: number | null;
  /** Virheviesti. */
  error: string | null;
  /** Onko molemmat opetettu → sovellus käyttövalmis. */
  complete: boolean;
}

/**
 * CalibrationViewModel ohjaa pillin ja pistoolin opettamisen. Opetus on
 * pakollinen: sovellus on käyttövalmis vasta, kun molemmat äänet on opetettu.
 */
export class CalibrationViewModel extends Observable<CalibrationState> {
  constructor(private readonly container: ServiceContainer) {
    const profiles = container.profiles.get();
    super({
      whistleStatus: profiles.whistle ? 'done' : 'idle',
      gunshotStatus: profiles.gunshot ? 'done' : 'idle',
      whistleFreqHz: profiles.whistle?.centerFreqHz ?? null,
      gunshotLevel: profiles.gunshot?.refRms ?? null,
      countdownMs: 0,
      liveLevel: 0,
      liveFreqHz: null,
      error: null,
      complete: container.profiles.isComplete(),
    });
  }

  /** Opettaa pillin: käyttäjää pyydetään viheltämään opetuksen ajan. */
  async teachWhistle(): Promise<void> {
    if (this.state.whistleStatus === 'recording') return;
    this.setState({ whistleStatus: 'recording', error: null, liveLevel: 0, liveFreqHz: null });
    try {
      const profile: WhistleProfile = await this.container.calibration.learnWhistle((p) =>
        this.setState({ countdownMs: p.msLeft, liveLevel: p.level, liveFreqHz: p.freqHz })
      );
      this.container.profiles.saveWhistle(profile);
      this.setState({
        whistleStatus: 'done',
        whistleFreqHz: profile.centerFreqHz,
        countdownMs: 0,
        liveLevel: 0,
        complete: this.container.profiles.isComplete(),
      });
      log.info('Pilli opetettu', profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ whistleStatus: 'error', error: msg, countdownMs: 0 });
    }
  }

  /** Opettaa pistoolin: käyttäjää pyydetään laukaisemaan opetuksen aikana. */
  async teachGunshot(): Promise<void> {
    if (this.state.gunshotStatus === 'recording') return;
    this.setState({ gunshotStatus: 'recording', error: null, liveLevel: 0, liveFreqHz: null });
    try {
      const profile: GunshotProfile = await this.container.calibration.learnGunshot((p) =>
        this.setState({ countdownMs: p.msLeft, liveLevel: p.level, liveFreqHz: p.freqHz })
      );
      this.container.profiles.saveGunshot(profile);
      this.setState({
        gunshotStatus: 'done',
        gunshotLevel: profile.refRms,
        countdownMs: 0,
        liveLevel: 0,
        complete: this.container.profiles.isComplete(),
      });
      log.info('Pistooli opetettu', profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ gunshotStatus: 'error', error: msg, countdownMs: 0 });
    }
  }

  /** Tyhjentää opetukset ja aloittaa alusta. */
  reset(): void {
    this.container.profiles.clear();
    this.setState({
      whistleStatus: 'idle',
      gunshotStatus: 'idle',
      whistleFreqHz: null,
      gunshotLevel: null,
      error: null,
      complete: false,
    });
  }
}
