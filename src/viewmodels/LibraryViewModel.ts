import type { RecordingSummary } from '@/models/types';
import type { ServiceContainer } from '@/services/container';
import { Share } from '@capacitor/share';
import { Observable } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';

const log = createLogger('LibraryViewModel');

export interface LibraryState {
  loading: boolean;
  items: RecordingSummary[];
  error: string | null;
}

/**
 * LibraryViewModel hallinnoi videokirjaston listanäkymää: lataus, poisto ja
 * jakaminen. Delegoi tietovaraston RecordingRepositorylle.
 */
export class LibraryViewModel extends Observable<LibraryState> {
  constructor(private readonly container: ServiceContainer) {
    super({ loading: false, items: [], error: null });
  }

  /** Lataa (tai päivittää) kirjaston. */
  async refresh(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const items = await this.container.repository.listSummaries();
      this.setState({ items, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ error: `Kirjaston lataus epäonnistui: ${msg}`, loading: false });
    }
  }

  /** Poistaa tallenteen ja päivittää listan. */
  async delete(id: string): Promise<void> {
    try {
      await this.container.repository.delete(id);
      await this.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ error: `Poisto epäonnistui: ${msg}` });
    }
  }

  /** Jakaa tallenteen ensisijaisen videon laitteen jakovalikon kautta. */
  async share(id: string): Promise<void> {
    try {
      const rec = await this.container.repository.get(id);
      if (!rec) return;
      const primary = rec.sources.find((s) => s.sourceId === rec.primarySourceId) ?? rec.sources[0];
      const uri = await this.container.storage.getFileUri(primary.videoPath);
      await Share.share({
        title: rec.competition,
        text: `Lähtövideo: ${rec.competition}`,
        url: uri,
        dialogTitle: 'Jaa lähtövideo',
      });
    } catch (err) {
      // Käyttäjä saattoi vain sulkea jakovalikon – ei kriittinen virhe.
      log.warn('Jakaminen ei onnistunut', err);
    }
  }
}
