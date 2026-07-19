import { AppConfig } from '@/config';
import type { GunshotProfile, WhistleProfile } from '@/models/audioProfile';
import { createLogger } from '@/utils/logger';
import { nowMonotonic } from '@/utils/time';

const log = createLogger('Calibration');

/** Kuinka kauan ääntä nauhoitetaan opetuksessa (ms). */
const CAPTURE_MS = 3000;

/**
 * CalibrationService opettaa pillin ja pistoolin äänet mikrofonista.
 *
 * Opetus nauhoittaa lyhyen näytteen, analysoi sen ja tuottaa äänisormenjäljen
 * (profiilin), jota tunnistus käyttää. Palvelu avaa oman mikrofonivirtansa
 * opetuksen ajaksi ja sulkee sen heti perään.
 */
export class CalibrationService {
  /**
   * Opettaa pillin: pyytää käyttäjää viheltämään ja etsii näytteestä
   * hallitsevan, yhtäjaksoisen sävelkorkeuden.
   * @param onCountdown  Kutsutaan jäljellä olevalla ajalla (ms) UI:ta varten.
   */
  async learnWhistle(onCountdown?: (msLeft: number) => void): Promise<WhistleProfile> {
    const { analyser, ctx, stream } = await this.openMic();
    const bins = analyser.frequencyBinCount;
    const freq = new Float32Array(bins);
    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / bins;

    // Kerää jokaiselta kehykseltä voimakkain taajuus + sen prominenssi.
    const peakFreqs: number[] = [];
    const prominences: number[] = [];

    await this.captureLoop(CAPTURE_MS, onCountdown, () => {
      analyser.getFloatFrequencyData(freq);

      // Etsi huippu järkevältä pillialueelta (0.8–8 kHz).
      const minBin = Math.floor(800 / binHz);
      const maxBin = Math.min(bins - 1, Math.ceil(8000 / binHz));
      let peakDb = -Infinity;
      let peakBin = -1;
      for (let i = minBin; i <= maxBin; i++) {
        if (freq[i] > peakDb) {
          peakDb = freq[i];
          peakBin = i;
        }
      }

      // Taustataso (keskiarvo äärellisistä arvoista).
      let sum = 0;
      let count = 0;
      for (let i = 0; i < bins; i++) {
        if (Number.isFinite(freq[i])) {
          sum += freq[i];
          count++;
        }
      }
      const background = count > 0 ? sum / count : -100;
      const prominence = peakDb - background;

      // Talteen vain selvästi taustan yli nousevat kehykset (tonaalinen ääni).
      if (peakBin >= 0 && prominence >= 8) {
        peakFreqs.push(peakBin * binHz);
        prominences.push(prominence);
      }
    });

    await this.closeMic(ctx, stream);

    if (peakFreqs.length < 5) {
      throw new Error('Pilliä ei tunnistettu. Vihellä selkeästi ja yritä uudelleen.');
    }

    const centerFreqHz = this.median(peakFreqs);
    const medianProm = this.median(prominences);
    const profile: WhistleProfile = {
      centerFreqHz: Math.round(centerFreqHz),
      // Kaista ±6 % sävelkorkeudesta (väh. 120 Hz) sallii pienen vaihtelun.
      toleranceHz: Math.max(120, Math.round(centerFreqHz * 0.06)),
      // Vaadi hieman opittua matalampi prominenssi, jotta tunnistus on varma
      // mutta ei liian herkkä.
      minProminenceDb: Math.max(10, Math.round(medianProm * 0.7)),
      minDurationMs: AppConfig.audio.whistle.minDurationMs,
    };
    log.info('Pilli opetettu', profile);
    return profile;
  }

  /**
   * Opettaa pistoolin: pyytää käyttäjää laukaisemaan ja mittaa laukauksen
   * huippuvoimakkuuden (transientti).
   */
  async learnGunshot(onCountdown?: (msLeft: number) => void): Promise<GunshotProfile> {
    const { analyser, ctx, stream } = await this.openMic();
    const time = new Float32Array(analyser.fftSize);

    let maxRms = 0;
    let backgroundRms = 0;
    let frames = 0;

    await this.captureLoop(CAPTURE_MS, onCountdown, () => {
      analyser.getFloatTimeDomainData(time);
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) sumSq += time[i] * time[i];
      const rms = Math.sqrt(sumSq / time.length);
      if (rms > maxRms) maxRms = rms;
      // Kevyt taustatason arvio ensimmäisistä kehyksistä.
      backgroundRms = frames === 0 ? rms : 0.95 * backgroundRms + 0.05 * rms;
      frames++;
    });

    await this.closeMic(ctx, stream);

    if (maxRms < 0.08) {
      throw new Error('Laukausta ei tunnistettu. Laukaise voimakkaammin ja yritä uudelleen.');
    }

    const ratio = backgroundRms > 1e-4 ? maxRms / backgroundRms : 8;
    const profile: GunshotProfile = {
      refRms: Math.round(maxRms * 1000) / 1000,
      // Vaadi selvä nousu taustaan nähden, väh. 4× (rajaa taputukset pois).
      onsetRatio: Math.max(4, Math.round(ratio * 0.6)),
    };
    log.info('Pistooli opetettu', profile);
    return profile;
  }

  // ---- Sisäiset apurit ----

  private async openMic(): Promise<{ analyser: AnalyserNode; ctx: AudioContext; stream: MediaStream }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    });
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: AppConfig.audio.targetSampleRate });
    if (ctx.state === 'suspended') await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = AppConfig.audio.fftSize;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    return { analyser, ctx, stream };
  }

  private async closeMic(ctx: AudioContext, stream: MediaStream): Promise<void> {
    stream.getTracks().forEach((t) => t.stop());
    if (ctx.state !== 'closed') await ctx.close();
  }

  /** Ajaa analyysisilmukan `durationMs` ajan ja ilmoittaa laskurin UI:lle. */
  private captureLoop(
    durationMs: number,
    onCountdown: ((msLeft: number) => void) | undefined,
    onFrame: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      const start = nowMonotonic();
      const tick = () => {
        const elapsed = nowMonotonic() - start;
        const left = durationMs - elapsed;
        if (left <= 0) {
          onCountdown?.(0);
          resolve();
          return;
        }
        onCountdown?.(left);
        onFrame();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
