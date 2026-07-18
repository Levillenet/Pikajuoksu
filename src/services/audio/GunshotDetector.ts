import { AppConfig } from '@/config';

/**
 * Starttipistoolin laukauksen tunnistin.
 *
 * Periaate: laukaus on erittäin lyhyt, laajakaistainen ja voimakas
 * transientti (impulssi). Toisin kuin pilli, se ei ole tonaalinen. Käytämme
 * "onset detection" -menetelmää: seuraamme signaalin RMS-energiaa ja liukuvaa
 * keskiarvoa. Kun hetkellinen energia ylittää liukuvan keskiarvon reilulla
 * kertoimella (ja absoluuttinen taso on riittävä), kyseessä on laukaus.
 *
 * Laukausta EI käytetä tallennuksen käynnistämiseen, vaan analyysin
 * nollakohtana (t=0).
 */
export class GunshotDetector {
  private readonly cfg = AppConfig.audio.gunshot;

  /** Liukuva keskiarvo taustaenergiasta (EMA). */
  private runningAvg = 0;
  private initialized = false;
  private lastDetectionMs = -Infinity;

  /** EMA-tasoituskerroin (pieni = hidas sopeutuminen taustaan). */
  private readonly alpha = 0.05;

  /**
   * Käsittelee yhden aikatason kehyksen.
   * @param timeData  Aikatason näytteet välillä -1..1 (getFloatTimeDomainData).
   * @param nowMs  Nykyhetki (monotoninen).
   * @returns luottamus 0..1 jos laukaus tunnistettiin, muuten null.
   */
  process(timeData: Float32Array, nowMs: number): number | null {
    // Laske kehyksen RMS-energia.
    let sumSq = 0;
    for (let i = 0; i < timeData.length; i++) {
      sumSq += timeData[i] * timeData[i];
    }
    const rms = Math.sqrt(sumSq / timeData.length);

    // Alusta liukuva keskiarvo ensimmäisillä kehyksillä.
    if (!this.initialized) {
      this.runningAvg = rms;
      this.initialized = true;
      return null;
    }

    const ratio = this.runningAvg > 1e-6 ? rms / this.runningAvg : Infinity;
    const cooledDown = nowMs - this.lastDetectionMs >= this.cfg.cooldownMs;

    const isOnset = ratio >= this.cfg.onsetRatio && rms >= this.cfg.minRms;

    let result: number | null = null;
    if (isOnset && cooledDown) {
      this.lastDetectionMs = nowMs;
      // Luottamus perustuu sekä suhteelliseen nousuun että absoluuttiseen tasoon.
      const ratioScore = Math.min(1, ratio / (this.cfg.onsetRatio * 2));
      const levelScore = Math.min(1, rms / (this.cfg.minRms * 3));
      result = Math.min(1, 0.5 * ratioScore + 0.5 * levelScore);
    }

    // Päivitä liukuvaa keskiarvoa vain, kun ei olla juuri transientin huipulla,
    // jotta itse laukaus ei nosta taustatasoa keinotekoisesti.
    if (!isOnset) {
      this.runningAvg = this.alpha * rms + (1 - this.alpha) * this.runningAvg;
    }

    return result;
  }

  reset(): void {
    this.runningAvg = 0;
    this.initialized = false;
    this.lastDetectionMs = -Infinity;
  }
}
