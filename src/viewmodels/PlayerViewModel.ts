import type { FalseStartAnalysis, StartRecording } from '@/models/types';
import type { ServiceContainer } from '@/services/container';
import { Observable } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';

const log = createLogger('PlayerViewModel');

/** Kehyksen oletuspituus (ms) 60 fps -videolle frame-askellusta varten. */
const FRAME_MS = 1000 / 60;

export interface PlayerState {
  loading: boolean;
  error: string | null;
  videoUrl: string | null;
  recording: StartRecording | null;
  /** Toiston nykyhetki (ms). */
  currentTimeMs: number;
  durationMs: number;
  playing: boolean;
  /** Toistonopeus (1 = normaali, 0.25 = hidastus). */
  playbackRate: number;
  /** Zoom-kerroin (1 = ei zoomia). */
  zoom: number;
  /** Analyysin tila. */
  analyzing: boolean;
  analysis: FalseStartAnalysis | null;
  /** Laukauksen offset (ms), näytetään aikajanalla. */
  gunshotOffsetMs: number | null;
}

const INITIAL: PlayerState = {
  loading: true,
  error: null,
  videoUrl: null,
  recording: null,
  currentTimeMs: 0,
  durationMs: 0,
  playing: false,
  playbackRate: 1,
  zoom: 1,
  analyzing: false,
  analysis: null,
  gunshotOffsetMs: null,
};

/**
 * PlayerViewModel hallitsee yksittäisen tallenteen katselua ja analyysia.
 *
 * Tarjoaa toiston ohjauksen (toista/pysäytä, hidastus, frame-askellus, zoom,
 * hyppy laukaushetkeen) sekä varaslähtöanalyysin käynnistämisen. Videon
 * DOM-elementti liitetään `attachVideo`-metodilla, mutta kaikki logiikka on
 * täällä, jotta näkymä pysyy ohuena.
 */
export class PlayerViewModel extends Observable<PlayerState> {
  private video: HTMLVideoElement | null = null;

  constructor(private readonly container: ServiceContainer) {
    super({ ...INITIAL });
  }

  /** Lataa tallenteen ja valmistelee toistettavan URL:n. */
  async load(recordingId: string): Promise<void> {
    this.replaceState({ ...INITIAL });
    try {
      const rec = await this.container.repository.get(recordingId);
      if (!rec) throw new Error('Tallennetta ei löytynyt');
      const primary = rec.sources.find((s) => s.sourceId === rec.primarySourceId) ?? rec.sources[0];
      const url = await this.container.storage.getPlayableUrl(primary.videoPath);
      this.setState({
        loading: false,
        videoUrl: url,
        recording: rec,
        analysis: rec.analysis,
        gunshotOffsetMs: primary.gunshotOffsetMs,
        durationMs: primary.durationMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ loading: false, error: msg });
    }
  }

  /** Liittää video-DOM-elementin ja kytkee tapahtumakuuntelijat. */
  attachVideo(el: HTMLVideoElement | null): void {
    this.video = el;
    if (!el) return;
    el.addEventListener('timeupdate', this.onTimeUpdate);
    el.addEventListener('loadedmetadata', this.onLoadedMetadata);
    el.addEventListener('play', () => this.setState({ playing: true }));
    el.addEventListener('pause', () => this.setState({ playing: false }));
  }

  private onLoadedMetadata = (): void => {
    if (this.video && Number.isFinite(this.video.duration)) {
      this.setState({ durationMs: this.video.duration * 1000 });
    }
  };

  private onTimeUpdate = (): void => {
    if (this.video) this.setState({ currentTimeMs: this.video.currentTime * 1000 });
  };

  // ---- Toiston ohjaus ----

  togglePlay(): void {
    if (!this.video) return;
    if (this.video.paused) void this.video.play();
    else this.video.pause();
  }

  /** Asettaa toistonopeuden (esim. 0.25 = hidastus). */
  setPlaybackRate(rate: number): void {
    if (!this.video) return;
    this.video.playbackRate = rate;
    this.setState({ playbackRate: rate });
  }

  /** Askeltaa yhden kehyksen eteen- tai taaksepäin (video pysäytettynä). */
  stepFrame(direction: 1 | -1): void {
    if (!this.video) return;
    this.video.pause();
    const next = Math.max(0, this.video.currentTime + (direction * FRAME_MS) / 1000);
    this.video.currentTime = next;
    this.setState({ currentTimeMs: next * 1000 });
  }

  /** Hyppää tiettyyn kohtaan (ms). */
  seekTo(ms: number): void {
    if (!this.video) return;
    const clamped = Math.max(0, Math.min(ms, this.state.durationMs));
    this.video.currentTime = clamped / 1000;
    this.setState({ currentTimeMs: clamped });
  }

  /** Hyppää laukaushetkeen (analyysin nollakohta). */
  jumpToGunshot(): void {
    if (this.state.gunshotOffsetMs !== null) this.seekTo(this.state.gunshotOffsetMs);
  }

  /** Zoomaus (rajattu 1..4). */
  setZoom(zoom: number): void {
    this.setState({ zoom: Math.max(1, Math.min(4, zoom)) });
  }

  /**
   * Käynnistää varaslähtöanalyysin nykyiselle videolle. Tulos tallennetaan
   * myös kirjastoon, jotta sitä ei tarvitse ajaa uudelleen.
   */
  async runAnalysis(): Promise<void> {
    const rec = this.state.recording;
    if (!this.video || !rec) return;
    if (this.state.gunshotOffsetMs === null) {
      this.setState({ error: 'Laukausta ei tunnistettu – analyysin nollakohta puuttuu.' });
      return;
    }

    this.setState({ analyzing: true, error: null });
    try {
      const wasPlaying = !this.video.paused;
      this.video.pause();

      const analyzer = this.container.createAnalyzer();
      const analysis = await analyzer.analyze(this.video, this.state.gunshotOffsetMs);

      // Tallenna analyysi kirjastoon.
      const updated: StartRecording = { ...rec, analysis };
      await this.container.repository.upsert(updated);

      this.setState({ analysis, recording: updated, analyzing: false });
      // Palauta soitin laukaushetkeen tulosten tarkastelua varten.
      this.jumpToGunshot();
      if (wasPlaying) void this.video.play();
      log.info('Analyysi valmis', { lanes: analysis.lanes.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ analyzing: false, error: `Analyysi epäonnistui: ${msg}` });
    }
  }

  /** Vapauttaa resurssit näkymästä poistuttaessa. */
  dispose(): void {
    if (this.video) {
      this.video.removeEventListener('timeupdate', this.onTimeUpdate);
      this.video.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    }
    // Vapauta blob-URL webissä muistivuotojen välttämiseksi.
    if (this.state.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(this.state.videoUrl);
    this.video = null;
  }
}
