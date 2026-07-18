import type { StartRecording, RecordingSummary } from '@/models/types';
import { StorageService } from './StorageService';
import { createLogger } from '@/utils/logger';

const log = createLogger('RecordingRepository');

/**
 * RecordingRepository on kirjaston "totuuden lähde". Se pitää yllä
 * tallenteiden metadataa (StartRecording[]) ja delegoi varsinaisten
 * videotiedostojen tallennuksen StorageServicelle.
 *
 * Repository-kuvio erottaa tietovaraston toteutuksen ViewModeleista, joten
 * taustajärjestelmän (esim. pilvitallennus tai usean laitteen synkronointi)
 * voi vaihtaa myöhemmin ilman UI-muutoksia.
 */
export class RecordingRepository {
  private recordings: StartRecording[] = [];
  private loaded = false;

  constructor(private readonly storage: StorageService = new StorageService()) {}

  /** Lataa kirjaston levyltä muistiin (kerran). */
  async load(): Promise<void> {
    if (this.loaded) return;
    const json = await this.storage.readLibraryJson();
    if (json) {
      try {
        this.recordings = JSON.parse(json) as StartRecording[];
      } catch (err) {
        log.error('Kirjaston lukeminen epäonnistui, aloitetaan tyhjästä', err);
        this.recordings = [];
      }
    }
    this.loaded = true;
    log.info('Kirjasto ladattu', { count: this.recordings.length });
  }

  private async persist(): Promise<void> {
    await this.storage.writeLibraryJson(JSON.stringify(this.recordings));
  }

  /** Lisää tai päivittää tallenteen ja tallentaa muutokset. */
  async upsert(recording: StartRecording): Promise<void> {
    await this.load();
    const idx = this.recordings.findIndex((r) => r.id === recording.id);
    if (idx >= 0) this.recordings[idx] = recording;
    else this.recordings.unshift(recording); // Uusin ensin.
    await this.persist();
  }

  /** Palauttaa kevyet yhteenvedot listaa varten, uusin ensin. */
  async listSummaries(): Promise<RecordingSummary[]> {
    await this.load();
    return this.recordings.map((r) => {
      const primary = r.sources.find((s) => s.sourceId === r.primarySourceId) ?? r.sources[0];
      return {
        id: r.id,
        createdAtEpochMs: r.createdAtEpochMs,
        competition: r.competition,
        durationMs: primary?.durationMs ?? 0,
        cameraCount: r.sources.length,
        suspiciousLaneCount: r.analysis?.lanes.filter((l) => l.suspicious).length ?? 0,
        hasAnalysis: r.analysis !== null,
      };
    });
  }

  /** Hakee yksittäisen tallenteen. */
  async get(id: string): Promise<StartRecording | undefined> {
    await this.load();
    return this.recordings.find((r) => r.id === id);
  }

  /** Poistaa tallenteen sekä sen videotiedostot. */
  async delete(id: string): Promise<void> {
    await this.load();
    const rec = this.recordings.find((r) => r.id === id);
    if (rec) {
      for (const source of rec.sources) {
        await this.storage.deleteVideo(source.videoPath);
      }
    }
    this.recordings = this.recordings.filter((r) => r.id !== id);
    await this.persist();
    log.info('Tallenne poistettu', { id });
  }

  getStorage(): StorageService {
    return this.storage;
  }
}
