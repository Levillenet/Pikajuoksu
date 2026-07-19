import { AppConfig } from '@/config';
import type { GunshotProfile, WhistleProfile } from '@/models/audioProfile';
import { createLogger } from '@/utils/logger';
import { nowMonotonic } from '@/utils/time';

const log = createLogger('Calibration');

/** Kuinka kauan ääntä nauhoitetaan opetuksessa (ms). */
const CAPTURE_MS = 3500;

/** Reaaliaikainen palaute opetuksen aikana (näkyvä palaute käyttäjälle). */
export interface LearnProgress {
  /** Jäljellä oleva aika (ms). */
  msLeft: number;
  /** Mikrofonin taso 0..1 (näkyy palkkina – kertoo että ääni kuuluu). */
  level: number;
  /** Hetkellinen hallitseva taajuus (Hz), tai null. */
  freqHz: number | null;
}

/**
 * CalibrationService opettaa pillin ja pistoolin äänet mikrofonista.
 *
 * Opetus nauhoittaa lyhyen näytteen, analysoi sen ja tuottaa äänisormenjäljen
 * (profiilin), jota tunnistus käyttää. Palvelu avaa oman mikrofonivirtansa
 * opetuksen ajaksi ja sulkee sen heti perään. Opetuksen aikana lähetetään
 * reaaliaikaista palautetta (taso + taajuus), jotta käyttäjä näkee, että ääni
 * kuuluu.
 */
export class CalibrationService {
  /**
   * Opettaa pillin: etsii näytteen hallitsevan sävelkorkeuden taajuuksien
   * kokonaisenergiasta (ei kiinteää dB-kynnystä → toimii myös matalatasoisilla
   * mikrofoneilla).
   */
  async learnWhistle(onProgress?: (p: LearnProgress) => void): Promise<WhistleProfile> {
    const { analyser, ctx, stream } = await this.openMic();
    const bins = analyser.frequencyBinCount;
    const freq = new Float32Array(bins);
    const time = new Float32Array(analyser.fftSize);
    const binHz = ctx.sampleRate / 2 / bins;

    const loBin = Math.floor(1000 / binHz);
    const hiBin = Math.min(bins - 1, Math.ceil(8000 / binHz));

    const energy = new Float64Array(bins);
    const prominences: number[] = [];
    let maxLevel = 0;

    await this.captureLoop(CAPTURE_MS, (msLeft) => {
      analyser.getFloatFrequencyData(freq);
      analyser.getFloatTimeDomainData(time);

      // Taso (RMS) reaaliaikaista palkkia varten.
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) sumSq += time[i] * time[i];
      const level = Math.min(1, Math.sqrt(sumSq / time.length) * 4);
      if (level > maxLevel) maxLevel = level;

      // Energia + kehyksen huippu.
      let framePeakDb = -Infinity;
      let framePeakBin = -1;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < bins; i++) {
        const db = freq[i];
        if (!Number.isFinite(db)) continue;
        sum += db;
        count++;
        if (i >= loBin && i <= hiBin) {
          energy[i] += Math.pow(10, db / 20);
          if (db > framePeakDb) {
            framePeakDb = db;
            framePeakBin = i;
          }
        }
      }
      const background = count > 0 ? sum / count : -100;
      if (Number.isFinite(framePeakDb)) prominences.push(framePeakDb - background);

      onProgress?.({
        msLeft,
        level,
        freqHz: framePeakBin >= 0 ? Math.round(framePeakBin * binHz) : null,
      });
    });

    await this.closeMic(ctx, stream);

    // Hallitseva taajuus = eniten energiaa kerännyt bini.
    let domBin = -1;
    let domE = -1;
    for (let i = loBin; i <= hiBin; i++) {
      if (energy[i] > domE) {
        domE = energy[i];
        domBin = i;
      }
    }

    prominences.sort((a, b) => a - b);
    const loudProm = prominences.length > 0 ? prominences[Math.floor(prominences.length * 0.9)] : 0;

    // Epäonnistu vain, jos ääntä ei käytännössä kuultu lainkaan.
    if (domBin < 0 || (loudProm < 4 && maxLevel < 0.05)) {
      throw new Error('Ääntä ei kuultu. Tarkista mikrofonilupa, vihellä kovempaa lähellä puhelinta ja yritä uudelleen.');
    }

    const centerFreqHz = domBin * binHz;
    const profile: WhistleProfile = {
      centerFreqHz: Math.round(centerFreqHz),
      toleranceHz: Math.max(150, Math.round(centerFreqHz * 0.07)),
      minProminenceDb: Math.min(18, Math.max(5, Math.round(loudProm * 0.5))),
      minDurationMs: AppConfig.audio.whistle.minDurationMs,
    };
    log.info('Pilli opetettu', { ...profile, loudProm: Math.round(loudProm), maxLevel });
    return profile;
  }

  /**
   * Opettaa pistoolin: mittaa laukauksen huippuvoimakkuuden (transientti).
   */
  async learnGunshot(onProgress?: (p: LearnProgress) => void): Promise<GunshotProfile> {
    const { analyser, ctx, stream } = await this.openMic();
    const time = new Float32Array(analyser.fftSize);

    let maxRms = 0;
    let backgroundRms = 0;
    let frames = 0;

    await this.captureLoop(CAPTURE_MS, (msLeft) => {
      analyser.getFloatTimeDomainData(time);
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) sumSq += time[i] * time[i];
      const rms = Math.sqrt(sumSq / time.length);
      if (rms > maxRms) maxRms = rms;
      backgroundRms = frames === 0 ? rms : 0.95 * backgroundRms + 0.05 * rms;
      frames++;
      onProgress?.({ msLeft, level: Math.min(1, rms * 4), freqHz: null });
    });

    await this.closeMic(ctx, stream);

    if (maxRms < 0.02 || maxRms < backgroundRms * 1.8) {
      throw new Error('Ääntä ei kuultu. Tarkista mikrofonilupa, laukaise/sano "PAM" napakasti lähellä puhelinta ja yritä uudelleen.');
    }

    const ratio = backgroundRms > 1e-4 ? maxRms / backgroundRms : 8;
    const profile: GunshotProfile = {
      refRms: Math.round(maxRms * 1000) / 1000,
      onsetRatio: Math.min(8, Math.max(3, Math.round(ratio * 0.5))),
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
    // EI pakotettua näytteenottotaajuutta – käytetään laitteen omaa, koska
    // pakottaminen tuottaa joillakin Android-laitteilla hiljaisuutta.
    const ctx = new AudioCtx();
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

  /** Ajaa analyysisilmukan `durationMs` ajan ja kutsuu onFrame(msLeft) joka kehys. */
  private captureLoop(durationMs: number, onFrame: (msLeft: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = nowMonotonic();
      const tick = () => {
        const elapsed = nowMonotonic() - start;
        const left = durationMs - elapsed;
        if (left <= 0) {
          resolve();
          return;
        }
        onFrame(left);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}
