import { AppConfig } from '@/config';
import type { AudioEvent, CameraSource, StartRecording } from '@/models/types';
import { CameraRecordingService } from '@/services/camera/CameraRecordingService';
import { CameraZoomController } from '@/services/camera/CameraZoomController';
import type { ServiceContainer } from '@/services/container';
import { Observable } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';
import { nowMonotonic } from '@/utils/time';

const log = createLogger('RecordingViewModel');

/** Tallennusprosessin vaiheet (tilakone). */
export type RecordingPhase = 'idle' | 'arming' | 'waiting' | 'recording' | 'saving' | 'error';

export interface RecordingState {
  phase: RecordingPhase;
  /** Jäljellä oleva tallennusaika (ms), näytetään käyttäjälle. */
  remainingMs: number;
  /** Reaaliaikainen mikrofonitaso 0..1 (visuaalinen palaute kuuntelusta). */
  micLevel: number;
  /** Pillin havaintohetki. */
  whistleAtEpochMs: number | null;
  /** Laukauksen offset (ms) tallennuksen alusta – analyysin nollakohta. */
  gunshotOffsetMs: number | null;
  /** Virheviesti, jos jokin epäonnistui. */
  error: string | null;
  /** Valmistuneen tallenteen id (navigointia varten). */
  lastRecordingId: string | null;
  /** Onko esikatselustriimi valmis näytettäväksi. */
  previewReady: boolean;
  /** Tukeeko laite kameran zoomin säätöä. */
  zoomSupported: boolean;
  /** Nykyinen zoom-taso (esim. 1 = normaali kuvakulma). */
  zoomLevel: number;
  /** Valittavat zoom-tasot laitteen mukaan (esim. [0.6, 1, 2]). */
  zoomPresets: number[];
}

const INITIAL: RecordingState = {
  phase: 'idle',
  remainingMs: AppConfig.minRecordingDurationMs,
  micLevel: 0,
  whistleAtEpochMs: null,
  gunshotOffsetMs: null,
  error: null,
  lastRecordingId: null,
  previewReady: false,
  zoomSupported: false,
  zoomLevel: 1,
  zoomPresets: [1],
};

/**
 * RecordingViewModel orkestroi koko automaattisen tallennusketjun:
 *
 *   VALMIS → kuuntele pilliä → (pilli) → käynnistä kamera & tallennus →
 *   kuuntele laukausta → merkitse laukauksen aikaleima → jatka väh. 2 min →
 *   pysäytä → tallenna video → (valinnainen) käynnistä varaslähtöanalyysi.
 *
 * Käyttäjän ei tarvitse koskea puhelimeen pillin jälkeen. Kaikki laitevirheet
 * (kamera, mikrofoni, tallennus) käsitellään ja raportoidaan käyttäjälle.
 */
export class RecordingViewModel extends Observable<RecordingState> {
  private readonly camera = new CameraRecordingService();
  private readonly zoom = new CameraZoomController();
  private sharedStream: MediaStream | null = null;
  private recordingStartMonotonicMs = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: Array<() => void> = [];
  private competition = '';

  constructor(private readonly container: ServiceContainer) {
    super(INITIAL);
  }

  /** Esikatselustriimi <video>-elementtiä varten (ei osa havainnoitavaa tilaa). */
  getPreviewStream(): MediaStream | null {
    return this.sharedStream;
  }

  /** Päivittää kilpailun/erän nimen (voidaan tehdä pilliä odottaessa). */
  setCompetition(name: string): void {
    if (name.trim()) this.competition = name.trim();
  }

  /**
   * Käynnistää valvonnan (VALMIS-painike). Hankkii kamera+mikki-striimin,
   * aloittaa mikrofonin kuuntelun ja jää odottamaan pilliä.
   */
  async arm(competition: string): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'error') return;
    this.competition = competition || 'Lähtö';
    this.replaceState({ ...INITIAL, phase: 'arming' });

    try {
      // Yksi lupa/striimi jaetaan tunnistuksen ja tallennuksen kesken.
      this.sharedStream = await CameraRecordingService.acquireStream();
      this.setState({ previewReady: true });

      // Kameran zoom: monet puhelimet valitsevat oletuksena laajakulman.
      // Luetaan laitteen tukemat zoom-tasot ja asetetaan oletukseksi 1×
      // (normaali kuvakulma). Käyttäjä voi vaihtaa tasoa UI:sta.
      this.zoom.attach(this.sharedStream);
      const applied = await this.zoom.applyDefaultZoom();
      // Näytä zoom-valitsin aina kameran ollessa päällä. Käytä laitteen
      // ilmoittamia tasoja jos saatavilla, muuten yleisiä tasoja – ja yritä
      // soveltaa niitä silti (osa laitteista tukee zoomia ilmoittamatta sitä).
      this.setState({
        zoomSupported: true,
        zoomLevel: applied || 1,
        zoomPresets: this.zoom.getPresetsForUi(),
      });

      // Käynnistä äänentunnistus samasta striimistä opetetuilla profiileilla.
      this.container.audio.resetDetectors();
      this.container.audio.setProfiles(this.container.profiles.get());
      await this.container.audio.start(this.sharedStream);
      this.container.audio.setListening({ whistle: true, gunshot: false });

      // Tilaa tapahtumat.
      this.unsub.push(
        this.container.audio.events.on('level', (level) => {
          // Päivitä mittari vain, jos muutos on merkittävä (vähemmän renderöintejä).
          if (Math.abs(level - this.state.micLevel) > 0.02) this.setState({ micLevel: level });
        })
      );
      this.unsub.push(this.container.audio.events.on('whistle', (e) => this.onWhistle(e)));
      this.unsub.push(this.container.audio.events.on('gunshot', (e) => this.onGunshot(e)));
      this.unsub.push(
        this.container.audio.events.on('error', (err) => this.fail(`Mikrofonivirhe: ${err.message}`))
      );

      this.setState({ phase: 'waiting' });
      log.info('Valvonta käynnistetty, odotetaan pilliä');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(`Kameran tai mikrofonin käynnistys epäonnistui: ${msg}`);
    }
  }

  /**
   * Asettaa kameran zoom-tason. Toimii sekä pilliä odottaessa että
   * tallennuksen aikana. Rajataan laitteen sallimaan alueeseen.
   */
  async setZoom(level: number): Promise<void> {
    const applied = await this.zoom.setZoom(level);
    this.setState({ zoomLevel: applied });
  }

  /** Pilli havaittu → aloita videon tallennus automaattisesti. */
  private onWhistle(event: AudioEvent): void {
    if (this.state.phase !== 'waiting') return;
    log.info('Pilli havaittu → aloitetaan tallennus');

    try {
      if (!this.sharedStream) throw new Error('Striimi puuttuu');
      this.camera.start(this.sharedStream);
      this.recordingStartMonotonicMs = nowMonotonic();

      // Nyt kuunnellaan laukausta (pilliä ei enää).
      this.container.audio.setListening({ whistle: false, gunshot: true });

      this.setState({
        phase: 'recording',
        whistleAtEpochMs: event.epochMs,
        remainingMs: AppConfig.minRecordingDurationMs,
      });

      this.startCountdown();

      // Pysäytä automaattisesti vähimmäiskeston jälkeen.
      this.stopTimer = setTimeout(() => {
        void this.finishRecording();
      }, AppConfig.minRecordingDurationMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(`Tallennuksen aloitus epäonnistui: ${msg}`);
    }
  }

  /** Laukaus havaittu → merkitse aikaleima (analyysin nollakohta). */
  private onGunshot(event: AudioEvent): void {
    if (this.state.phase !== 'recording' || this.state.gunshotOffsetMs !== null) return;
    const offsetMs = event.monotonicMs - this.recordingStartMonotonicMs;
    log.info('Laukaus merkitty', { offsetMs: Math.round(offsetMs) });
    this.setState({ gunshotOffsetMs: offsetMs });
    // Emme pysäytä tallennusta – jatketaan vähintään 2 min kokonaiskesto.
  }

  private startCountdown(): void {
    const endAt = nowMonotonic() + AppConfig.minRecordingDurationMs;
    this.countdownTimer = setInterval(() => {
      const remaining = Math.max(0, endAt - nowMonotonic());
      this.setState({ remainingMs: remaining });
      // Kova yläraja turvaverkkona (akku/muisti).
      const elapsed = nowMonotonic() - this.recordingStartMonotonicMs;
      if (elapsed >= AppConfig.maxRecordingDurationMs) void this.finishRecording();
    }, 200);
  }

  /** Käyttäjä voi halutessaan lopettaa aikaisin (esim. hälytys peruttiin). */
  async stopEarly(): Promise<void> {
    if (this.state.phase === 'recording') await this.finishRecording();
  }

  /** Lopettaa tallennuksen, tallentaa videon ja luo kirjastomerkinnän. */
  private async finishRecording(): Promise<void> {
    if (this.state.phase !== 'recording') return;
    this.clearTimers();
    this.setState({ phase: 'saving' });

    try {
      const result = await this.camera.stop();

      const id = this.generateId();
      const videoPath = await this.container.storage.saveVideo(id, result.blob, result.mimeType);

      const source: CameraSource = {
        sourceId: 'primary',
        label: 'Puhelin A',
        videoPath,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        gunshotOffsetMs: this.state.gunshotOffsetMs,
      };

      const recording: StartRecording = {
        id,
        createdAtEpochMs: Date.now(),
        competition: this.competition,
        primarySourceId: source.sourceId,
        sources: [source],
        whistleDetectedEpochMs: this.state.whistleAtEpochMs,
        gunshot: this.state.gunshotOffsetMs !== null ? this.buildGunshotEvent() : null,
        analysis: null,
      };

      await this.container.repository.upsert(recording);
      log.info('Tallenne valmis ja tallennettu', { id });

      // Lähiyhteys: jos rooli on Camera ja Viewer on yhdistetty, lähetä video
      // automaattisesti. Ei vaikuta paikalliseen tallennukseen eikä kaada
      // tallennusketjua, vaikka lähetys epäonnistuisi.
      try {
        const uri = await this.container.storage.getFileUri(videoPath);
        void this.container.nearby.onRecordingSaved(recording, uri);
      } catch (err) {
        log.warn('Videon lähetystä lähiyhteydellä ei voitu aloittaa', err);
      }

      this.setState({ phase: 'idle', lastRecordingId: id, remainingMs: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(`Videon tallennus epäonnistui: ${msg}`);
    } finally {
      await this.teardownCapture();
    }
  }

  private buildGunshotEvent(): AudioEvent {
    return {
      type: 'gunshot',
      monotonicMs: this.recordingStartMonotonicMs + (this.state.gunshotOffsetMs ?? 0),
      epochMs: (this.state.whistleAtEpochMs ?? Date.now()) + (this.state.gunshotOffsetMs ?? 0),
      confidence: 1,
      offsetFromRecordingStartMs: this.state.gunshotOffsetMs ?? undefined,
    };
  }

  /** Peruuttaa valvonnan ja palaa alkutilaan (esim. Takaisin-painike). */
  async cancel(): Promise<void> {
    this.clearTimers();
    if (this.camera.isRecording()) {
      try {
        await this.camera.stop();
      } catch {
        /* ohitetaan – peruutus */
      }
    }
    await this.teardownCapture();
    this.replaceState({ ...INITIAL });
  }

  private fail(message: string): void {
    log.error(message);
    this.clearTimers();
    void this.teardownCapture();
    this.setState({ phase: 'error', error: message });
  }

  private async teardownCapture(): Promise<void> {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.zoom.detach();
    await this.container.audio.stop(true);
    this.sharedStream?.getTracks().forEach((t) => t.stop());
    this.sharedStream = null;
    this.setState({ previewReady: false, micLevel: 0 });
  }

  private clearTimers(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.countdownTimer = null;
    this.stopTimer = null;
  }

  private generateId(): string {
    // Aikaleima + satunnaisosa riittää yksilöintiin yhdellä laitteella.
    return `rec_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  /** Kuittaa virheen ja palaa alkuun. */
  dismissError(): void {
    this.replaceState({ ...INITIAL });
  }
}
