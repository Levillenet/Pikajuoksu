import { createLogger } from '@/utils/logger';
import { nowMonotonic } from '@/utils/time';

const log = createLogger('CameraRecording');

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Monotoninen aikaleima tallennuksen alkamishetkellä (synkronointia varten). */
  startMonotonicMs: number;
}

/**
 * CameraRecordingService hoitaa takakameran videon tallennuksen MediaRecorderilla.
 *
 * Se ei itse pyydä mikrofonia – se saa valmiin MediaStreamin (video + jaettu
 * ääniraita), jolloin sama mikrofonilupa palvelee sekä tunnistusta että
 * videon ääniraitaa. Näin laukauksen ääni on myös videossa, mikä on
 * välttämätöntä usean kameran synkronoinnissa.
 */
export class CameraRecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startMonotonicMs = 0;
  private mimeType = '';

  /**
   * Hankkii yhdistetyn video+ääni-striimin. Video takakamerasta
   * (facingMode: 'environment'), ääni jaetaan tunnistuspalvelun kanssa.
   */
  static async acquireStream(): Promise<MediaStream> {
    // Käytetään vain `ideal`-rajoitteita (ei `min`/`exact`), jotta selain saa
    // heikentää asetuksia sulavasti sen sijaan, että getUserMedia hylkäisi
    // pyynnön OverconstrainedError-virheellä laitteilla, jotka eivät tue
    // korkeaa resoluutiota tai kuvataajuutta.
    const ideal: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' }, // Takakamera.
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 }, // Korkea fps = tarkempi analyysi.
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };
    try {
      return await navigator.mediaDevices.getUserMedia(ideal);
    } catch (err) {
      // Varasuunnitelma: yritä minimaalisilla rajoitteilla (video + ääni),
      // jotta sovellus toimii myös rajoitetuilla kameroilla.
      log.warn('Ideaalirajoitteet epäonnistuivat, yritetään perusasetuksilla', err);
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err2) {
        const error = err2 instanceof Error ? err2 : new Error(String(err2));
        log.error('Kameran/mikrofonin hankinta epäonnistui', error);
        throw error;
      }
    }
  }

  /**
   * Valitsee parhaan tuetun tallennusmuodon. Androidilla webm/mp4,
   * iOS:llä mp4. Tarkistetaan ajonaikaisesti.
   */
  private pickMimeType(): string {
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const type of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Anna selaimen valita oletus.
  }

  /** Aloittaa tallennuksen annetusta striimistä. */
  start(stream: MediaStream): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      log.warn('Tallennus on jo käynnissä');
      return;
    }
    this.chunks = [];
    this.mimeType = this.pickMimeType();

    const options: MediaRecorderOptions = {
      videoBitsPerSecond: 8_000_000, // ~8 Mbps riittää terävään 1080p-analyysiin.
    };
    if (this.mimeType) options.mimeType = this.mimeType;

    try {
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (err) {
      log.warn('MediaRecorder-optiot hylättiin, käytetään oletuksia', err);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.onerror = (e) => {
      log.error('MediaRecorder-virhe', e);
    };

    this.startMonotonicMs = nowMonotonic();
    // Pyydetään dataa 1 s välein → jos sovellus kaatuu, osa videosta säilyy.
    this.mediaRecorder.start(1000);
    log.info('Videon tallennus aloitettu', { mimeType: this.mimeType });
  }

  /** Lopettaa tallennuksen ja palauttaa koko videon Blobina. */
  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('Tallennus ei ole käynnissä'));
        return;
      }
      recorder.onstop = () => {
        const durationMs = nowMonotonic() - this.startMonotonicMs;
        const type = this.mimeType || (this.chunks[0]?.type ?? 'video/webm');
        const blob = new Blob(this.chunks, { type });
        log.info('Videon tallennus valmis', {
          durationMs: Math.round(durationMs),
          bytes: blob.size,
        });
        resolve({ blob, mimeType: type, durationMs, startMonotonicMs: this.startMonotonicMs });
      };
      recorder.stop();
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}
