import { AppConfig } from '@/config';
import type { AudioEvent } from '@/models/types';
import type { AudioProfiles } from '@/models/audioProfile';
import { EventBus } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';
import { nowMonotonic } from '@/utils/time';
import { WhistleDetector } from './WhistleDetector';
import { GunshotDetector } from './GunshotDetector';

const log = createLogger('AudioDetection');

// type-alias (ei interface), jotta se toteuttaa EventBusin
// Record<string, unknown> -rajoituksen.
export type AudioServiceEvents = {
  whistle: AudioEvent;
  gunshot: AudioEvent;
  error: Error;
  /** Reaaliaikainen tasomittari UI:ta varten (0..1). */
  level: number;
};

/**
 * AudioDetectionService kuuntelee mikrofonia jatkuvasti ja tunnistaa sekä
 * pillin (tallennuksen laukaisin) että starttipistoolin (analyysin nollakohta).
 *
 * Sama mikrofonivirta jaetaan tunnistuksen ja mahdollisen tallennuksen kesken.
 * Palvelu on laiteriippuvainen (Web Audio API), mutta se paljastaa vain
 * tapahtumia, joten ViewModelit pysyvät puhtaina.
 */
export class AudioDetectionService {
  readonly events = new EventBus<AudioServiceEvents>();

  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // Selkeä ArrayBuffer-tyypitys, jotta AnalyserNoden get*Data-metodit hyväksyvät.
  private freqData: Float32Array<ArrayBuffer> | null = null;
  private timeData: Float32Array<ArrayBuffer> | null = null;

  private readonly whistleDetector = new WhistleDetector();
  private readonly gunshotDetector = new GunshotDetector();

  private rafHandle: number | null = null;
  private running = false;

  /**
   * Kumpia tapahtumia kuunnellaan aktiivisesti. Tallennuksen aikana
   * kuunnellaan laukausta; ennen tallennusta pilliä. Molemmat voivat olla
   * päällä yhtä aikaa.
   */
  private listenWhistle = true;
  private listenGunshot = true;

  /**
   * Käynnistää mikrofonin ja tunnistussilmukan. Palauttaa käytetyn
   * MediaStreamin, jotta sen voi jakaa kameratallennuksen kanssa
   * (yksi mikrofonilupa riittää).
   */
  async start(existingStream?: MediaStream): Promise<MediaStream> {
    if (this.running) {
      log.warn('start() kutsuttiin, mutta palvelu on jo käynnissä');
      return this.stream!;
    }

    try {
      // Käytä olemassa olevaa striimiä (esim. kamera+mikki) tai pyydä uusi.
      this.stream =
        existingStream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false, // Emme halua suodattaa transientteja pois.
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
          video: false,
        }));

      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: AppConfig.audio.targetSampleRate });

      // iOS vaatii resume-kutsun käyttäjän eleen jälkeen.
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = AppConfig.audio.fftSize;
      this.analyser.smoothingTimeConstant = 0; // Ei tasoitusta → tarkat transientit.

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.sourceNode.connect(this.analyser);
      // Huom: emme yhdistä destinationiin → ei kaikua kaiuttimista.

      this.freqData = new Float32Array(this.analyser.frequencyBinCount);
      this.timeData = new Float32Array(this.analyser.fftSize);

      this.running = true;
      this.loop();
      log.info('Mikrofonin kuuntelu käynnistetty', {
        sampleRate: this.audioContext.sampleRate,
      });
      return this.stream;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Mikrofonin käynnistys epäonnistui', error);
      this.events.emit('error', error);
      throw error;
    }
  }

  /** Tunnistussilmukka, joka ajetaan animaatiokehyksen tahdissa (~60 Hz). */
  private loop = (): void => {
    if (!this.running || !this.analyser || !this.freqData || !this.timeData) return;

    const now = nowMonotonic();
    this.analyser.getFloatFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);

    // Reaaliaikainen tasomittari UI:lle.
    let peak = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const a = Math.abs(this.timeData[i]);
      if (a > peak) peak = a;
    }
    this.events.emit('level', peak);

    const sampleRate = this.audioContext!.sampleRate;

    if (this.listenGunshot) {
      const conf = this.gunshotDetector.process(this.timeData, now);
      if (conf !== null) {
        log.info('Laukaus havaittu', { confidence: conf });
        this.events.emit('gunshot', this.buildEvent('gunshot', now, conf));
      }
    }

    if (this.listenWhistle) {
      const conf = this.whistleDetector.process(this.freqData, sampleRate, now);
      if (conf !== null) {
        log.info('Pilli havaittu', { confidence: conf });
        this.events.emit('whistle', this.buildEvent('whistle', now, conf));
      }
    }

    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private buildEvent(type: AudioEvent['type'], monotonicMs: number, confidence: number): AudioEvent {
    return {
      type,
      monotonicMs,
      epochMs: Date.now(),
      confidence,
    };
  }

  /** Ohjaa, kumpia tapahtumia kuunnellaan. */
  setListening(opts: { whistle?: boolean; gunshot?: boolean }): void {
    if (opts.whistle !== undefined) this.listenWhistle = opts.whistle;
    if (opts.gunshot !== undefined) this.listenGunshot = opts.gunshot;
  }

  /** Nollaa tunnistimet uutta lähtöä varten. */
  resetDetectors(): void {
    this.whistleDetector.reset();
    this.gunshotDetector.reset();
  }

  /** Asettaa opetetut ääniprofiilit tunnistimille ennen valvonnan alkua. */
  setProfiles(profiles: AudioProfiles): void {
    this.whistleDetector.setProfile(profiles.whistle);
    this.gunshotDetector.setProfile(profiles.gunshot);
  }

  /** Pysäyttää kuuntelun ja vapauttaa resurssit. */
  async stop(closeStream = true): Promise<void> {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
    if (closeStream) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    log.info('Mikrofonin kuuntelu pysäytetty');
  }

  isRunning(): boolean {
    return this.running;
  }
}
