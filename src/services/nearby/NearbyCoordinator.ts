import type { CameraSource, StartRecording } from '@/models/types';
import type { VideoTransferMetadata } from '@/models/nearby';
import type { ConnectionManager } from './ConnectionManager';
import type { RecordingRepository } from '../storage/RecordingRepository';
import type { SettingsStore } from '../settings/SettingsStore';
import { createLogger } from '@/utils/logger';

const log = createLogger('NearbyCoordinator');

/**
 * NearbyCoordinator liittää lähiyhteyden (ConnectionManager) sovelluksen
 * tallennus- ja kirjastologiikkaan – pitäen verkkokoodin ConnectionManagerissa.
 *
 *  - Camera: kun tallenne on valmis ja Viewer yhdistetty, video lähetetään
 *    metatietoineen automaattisesti.
 *  - Viewer: kun video vastaanotetaan, se tallennetaan kirjastoon, lisätään
 *    listaan ja uusin avataan automaattisesti.
 */
export class NearbyCoordinator {
  /** Callback, jonka App asettaa uuden vastaanotetun videon avaamiseksi. */
  private onOpenRecording: ((id: string) => void) | null = null;

  constructor(
    private readonly connection: ConnectionManager,
    private readonly repository: RecordingRepository,
    private readonly settings: SettingsStore
  ) {}

  /**
   * Käynnistää lähiyhteyden valitulla roolilla ja kytkee vastaanoton.
   * Kutsutaan sovelluksen käynnistyessä. Turvallinen myös web-alustalla.
   */
  async init(onOpenRecording: (id: string) => void): Promise<void> {
    this.onOpenRecording = onOpenRecording;

    // Viewer: vastaanota videot ja lisää ne kirjastoon.
    this.connection.events.on('fileReceived', ({ path, metadata }) => {
      void this.onFileReceived(path, metadata);
    });

    const role = this.settings.getRole();
    if (role) await this.connection.start(role);
  }

  /** Vaihtaa roolin lennossa ja käynnistää yhteyden uudelleen. */
  async setRole(role: 'camera' | 'viewer'): Promise<void> {
    this.settings.setRole(role);
    await this.connection.start(role);
  }

  /**
   * Camera: kutsutaan kun tallenne on valmis. Lähettää videon Viewerille jos
   * rooli on camera ja yhteys on. Muuten ei tee mitään (video jää talteen).
   */
  async onRecordingSaved(recording: StartRecording, absoluteVideoUri: string): Promise<void> {
    if (this.settings.getRole() !== 'camera') return;
    if (!this.connection.isConnected()) {
      log.info('Ei Viewer-yhteyttä – video jää paikallisesti talteen');
      return;
    }
    const primary = recording.sources.find((s) => s.sourceId === recording.primarySourceId) ?? recording.sources[0];
    const metadata: VideoTransferMetadata = {
      recordingId: recording.id,
      competition: recording.competition,
      createdAtEpochMs: recording.createdAtEpochMs,
      durationMs: primary.durationMs,
      fileSizeBytes: 0, // Natiivi täyttää todellisen koon tarvittaessa.
      mimeType: primary.mimeType,
      gunshotOffsetMs: primary.gunshotOffsetMs,
    };
    // Ilmoita ensin, että uusi video on tulossa (protokolla).
    await this.connection.sendMessage({ type: 'NEW_VIDEO_AVAILABLE', payload: metadata });
    await this.connection.sendVideo(absoluteVideoUri, metadata);
  }

  /** Viewer: tallenna vastaanotettu video kirjastoon ja avaa se. */
  private async onFileReceived(path: string, metadata: VideoTransferMetadata): Promise<void> {
    try {
      const source: CameraSource = {
        sourceId: 'received',
        label: 'Vastaanotettu',
        videoPath: path, // Natiivi absoluuttinen polku – toistetaan sellaisenaan.
        mimeType: metadata.mimeType || 'video/mp4',
        durationMs: metadata.durationMs,
        gunshotOffsetMs: metadata.gunshotOffsetMs,
      };
      const recording: StartRecording = {
        id: metadata.recordingId || `recv_${Date.now().toString(36)}`,
        createdAtEpochMs: metadata.createdAtEpochMs || Date.now(),
        competition: metadata.competition || 'Vastaanotettu lähtö',
        primarySourceId: source.sourceId,
        sources: [source],
        whistleDetectedEpochMs: null,
        gunshot: null,
        analysis: null,
      };
      await this.repository.upsert(recording);
      log.info('Video vastaanotettu ja tallennettu', { id: recording.id });
      // Avaa uusin video automaattisesti.
      this.onOpenRecording?.(recording.id);
    } catch (err) {
      log.error('Vastaanotetun videon tallennus epäonnistui', err);
    }
  }
}
