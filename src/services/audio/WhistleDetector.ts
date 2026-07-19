import { AppConfig } from '@/config';
import type { WhistleProfile } from '@/models/audioProfile';

/**
 * Pillin tunnistin.
 *
 * Periaate: pilli tuottaa kirkkaan, kapeakaistaisen ja suhteellisen pitkän
 * (>150 ms) sävelen n. 2–4 kHz alueella. Analysoimme AnalyserNoden
 * taajuusspektriä (dB) ja etsimme selkeän huipun kohdealueelta, joka nousee
 * riittävästi taustatason yläpuolelle ja kestää tarpeeksi kauan.
 *
 * Luokka on tilallinen (seuraa sävelen kestoa ja jäähdytystä), mutta ei
 * riipu Web Audiosta suoraan – sille syötetään valmis taajuusdata, joten
 * se on yksikkötestattavissa.
 */
export class WhistleDetector {
  private readonly cfg = AppConfig.audio.whistle;

  /** Aikaleima (ms), jolloin sävel alkoi ylittää kynnyksen. */
  private toneStartMs: number | null = null;
  /** Aikaleima (ms) viimeisimmästä hyväksytystä havainnosta (jäähdytys). */
  private lastDetectionMs = -Infinity;

  /**
   * Opetettu profiili. Kun asetettu, tunnistus rajautuu opitulle
   * sävelkorkeudelle → yleiset äänet (esim. yskäisy) eivät enää kelpaa.
   */
  private profile: WhistleProfile | null = null;

  /** Asettaa opetetun pilliprofiilin (tai poistaa sen arvolla null). */
  setProfile(profile: WhistleProfile | null): void {
    this.profile = profile;
    this.reset();
  }

  /**
   * Käsittelee yhden taajuuskehyksen.
   * @param freqDb  Taajuusspektri desibeleinä (AnalyserNode.getFloatFrequencyData).
   * @param sampleRate  AudioContextin näytteenottotaajuus.
   * @param nowMs  Nykyhetki (monotoninen).
   * @returns luottamus 0..1 jos pilli tunnistettiin, muuten null.
   */
  process(freqDb: Float32Array, sampleRate: number, nowMs: number): number | null {
    const nyquist = sampleRate / 2;
    const binHz = nyquist / freqDb.length;

    // Käytä opetettua kapeaa kaistaa, jos profiili on asetettu. Muuten
    // yleinen laaja kaista konfiguraatiosta (varajärjestely).
    const minFreq = this.profile ? this.profile.centerFreqHz - this.profile.toleranceHz : this.cfg.minFreqHz;
    const maxFreq = this.profile ? this.profile.centerFreqHz + this.profile.toleranceHz : this.cfg.maxFreqHz;
    const thresholdDb = this.profile ? this.profile.minProminenceDb : this.cfg.thresholdDb;
    const minDurationMs = this.profile ? this.profile.minDurationMs : this.cfg.minDurationMs;

    const minBin = Math.max(0, Math.floor(minFreq / binHz));
    const maxBin = Math.min(freqDb.length - 1, Math.ceil(maxFreq / binHz));

    // Etsi voimakkain huippu pillin taajuusalueelta.
    let peakDb = -Infinity;
    for (let i = minBin; i <= maxBin; i++) {
      if (freqDb[i] > peakDb) peakDb = freqDb[i];
    }

    // Arvioi taustataso (mediaani koko spektristä approksimoituna keskiarvolla).
    let sum = 0;
    let count = 0;
    for (let i = 0; i < freqDb.length; i++) {
      // Ohitetaan -Infinity (hiljaiset binit).
      if (Number.isFinite(freqDb[i])) {
        sum += freqDb[i];
        count++;
      }
    }
    const background = count > 0 ? sum / count : -100;
    const prominence = peakDb - background;

    const aboveThreshold = prominence >= thresholdDb;

    if (aboveThreshold) {
      // Sävel jatkuu tai alkaa.
      if (this.toneStartMs === null) this.toneStartMs = nowMs;

      const heldMs = nowMs - this.toneStartMs;
      const cooledDown = nowMs - this.lastDetectionMs >= this.cfg.cooldownMs;

      if (heldMs >= minDurationMs && cooledDown) {
        this.lastDetectionMs = nowMs;
        this.toneStartMs = null;
        // Luottamus skaalautuu prominenssin mukaan (12 dB → ~0.5, 30 dB → ~1).
        const confidence = Math.min(1, prominence / 30);
        return confidence;
      }
    } else {
      // Sävel katkesi → nollaa alkuhetki.
      this.toneStartMs = null;
    }

    return null;
  }

  /** Nollaa tilan (esim. uutta lähtöä varten). */
  reset(): void {
    this.toneStartMs = null;
    this.lastDetectionMs = -Infinity;
  }
}
