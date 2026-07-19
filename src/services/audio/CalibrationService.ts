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

    // Pillialue 1–8 kHz.
    const loBin = Math.floor(1000 / binHz);
    const hiBin = Math.min(bins - 1, Math.ceil(8000 / binHz));

    // Kerää taajuuksien KOKONAISENERGIA koko opetuksen ajalta (lineaarinen).
    // Näin hallitseva sävel löytyy ilman kiinteää dB-kynnystä → toimii myös
    // laitteilla, joilla mikrofonin taso on matala. Lisäksi seurataan kunkin
    // kehyksen prominenssia tunnistuskynnyksen säätöä varten.
    const energy = new Float64Array(bins);
    const prominences: number[] = [];

    await this.captureLoop(CAPTURE_MS, onCountdown, () => {
      analyser.getFloatFrequencyData(freq);

      let framePeakDb = -Infinity;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < bins; i++) {
        const db = freq[i];
        if (!Number.isFinite(db)) continue;
        sum += db;
        count++;
        if (i >= loBin && i <= hiBin) {
          // Muunna dB lineaariseksi magnitudiksi ja summaa energia.
          energy[i] += Math.pow(10, db / 20);
          if (db > framePeakDb) framePeakDb = db;
        }
      }
      const background = count > 0 ? sum / count : -100;
      if (Number.isFinite(framePeakDb)) prominences.push(framePeakDb - background);
    });

    await this.closeMic(ctx, stream);

    // Hallitseva taajuus = eniten energiaa kerännyt bini pillialueella.
    let domBin = -1;
    let domE = -1;
    for (let i = loBin; i <= hiBin; i++) {
      if (energy[i] > domE) {
        domE = energy[i];
        domBin = i;
      }
    }

    // Arvioi "kova pilli" -taso: prominenssien korkea persentiili.
    prominences.sort((a, b) => a - b);
    const loudProm = prominences.length > 0 ? prominences[Math.floor(prominences.length * 0.9)] : 0;

    // Epäonnistu vain, jos ääntä ei käytännössä kuultu lainkaan.
    if (domBin < 0 || loudProm < 4) {
      throw new Error('Ääntä ei kuultu. Vihellä kovempaa lähellä puhelinta ja yritä uudelleen.');
    }

    const centerFreqHz = domBin * binHz;
    const profile: WhistleProfile = {
      centerFreqHz: Math.round(centerFreqHz),
      // Kaista ±7 % sävelkorkeudesta (väh. 150 Hz) sallii pienen vaihtelun.
      toleranceHz: Math.max(150, Math.round(centerFreqHz * 0.07)),
      // Tunnistuskynnys suhteessa opittuun tasoon (puolet kovan pillin
      // prominenssista), rajattu 5–18 dB. Väärät laukaisut estetään ensisijassa
      // "hallitseva huippu" -vaatimuksella tunnistimessa, ei tällä kynnyksellä.
      minProminenceDb: Math.min(18, Math.max(5, Math.round(loudProm * 0.5))),
      minDurationMs: AppConfig.audio.whistle.minDurationMs,
    };
    log.info('Pilli opetettu', { ...profile, loudProm: Math.round(loudProm) });
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

    // Epäonnistu vain, jos ääntä ei kuultu lainkaan tai se ei erottunut
    // taustasta. Matala absoluuttinen raja (0.02) toimii myös hiljaisilla
    // mikrofoneilla; suhteellinen raja varmistaa, että ääni erottuu taustasta.
    if (maxRms < 0.02 || maxRms < backgroundRms * 1.8) {
      throw new Error('Ääntä ei kuultu. Laukaise/sano "PAM" napakasti lähellä puhelinta ja yritä uudelleen.');
    }

    const ratio = backgroundRms > 1e-4 ? maxRms / backgroundRms : 8;
    const profile: GunshotProfile = {
      refRms: Math.round(maxRms * 1000) / 1000,
      // Rajaa nousukynnys välille 3–8×. Opetushetkellä tausta on usein hyvin
      // hiljainen, jolloin laskettu suhde kasvaa valtavaksi ja tekisi
      // tunnistuksesta käytännössä mahdotonta. Kova yläraja pitää laukauksen
      // tunnistettavana myös kentällä.
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
}
