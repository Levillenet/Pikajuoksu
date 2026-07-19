import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type {
  ConnectionState,
  DeviceRole,
  NearbyMessage,
  VideoTransferMetadata,
} from '@/models/nearby';
import { NearbyConnections } from '@/plugins/NearbyConnections';
import { Observable, EventBus } from '@/utils/Observable';
import { createLogger } from '@/utils/logger';

const log = createLogger('ConnectionManager');

/** Yhteinen palvelutunniste (molempien roolien on täsmättävä). */
const SERVICE_ID = 'fi.pikajuoksu.startwatch.nearby';

export interface ConnectionManagerState {
  /** Onko natiivi lähiyhteys käytettävissä (Android). */
  available: boolean;
  role: DeviceRole | null;
  status: ConnectionState;
  endpointName: string | null;
  /** Käynnissä olevan siirron eteneminen 0..1, tai null. */
  transferFraction: number | null;
  transferDirection: 'incoming' | 'outgoing' | null;
  /** Viimeisin virheviesti (ei kaada muuta sovellusta). */
  error: string | null;
}

/** Tapahtumat, joita muut osat (esim. Viewer) kuuntelevat. */
export type ConnectionManagerEvents = {
  /** Vastaanotettu viesti (Camera↔Viewer-protokolla). */
  message: NearbyMessage;
  /** Vastaanotettu videotiedosto + metatiedot (Viewer). */
  fileReceived: { path: string; metadata: VideoTransferMetadata };
};

const INITIAL: ConnectionManagerState = {
  available: false,
  role: null,
  status: 'disconnected',
  endpointName: null,
  transferFraction: null,
  transferDirection: null,
  error: null,
};

/**
 * ConnectionManager on ainoa paikka, joka puhuu Nearby-pluginille. Se:
 *  - käynnistää automaattisesti Advertisingin (Camera) tai Discoveryn (Viewer)
 *  - valvoo yhteyden tilaa ja yrittää yhdistää uudelleen katkoksen jälkeen
 *  - lähettää viestejä ja videotiedostoja
 *  - julkaisee tilan ja tapahtumat muulle sovellukselle
 *
 * Muu sovellus ei sisällä lainkaan verkko-/yhteyskoodia. Web-alustalla tämä
 * degradoituu turvallisesti (available=false), joten nykyinen toiminta säilyy.
 */
export class ConnectionManager extends Observable<ConnectionManagerState> {
  readonly events = new EventBus<ConnectionManagerEvents>();

  private pluginListeners: PluginListenerHandle[] = [];
  private started = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceName = 'FSD-' + Math.floor(Math.random() * 1e4).toString().padStart(4, '0');

  constructor() {
    super({ ...INITIAL });
  }

  /**
   * Käynnistää lähiyhteyden annetulla roolilla. Turvallinen kutsua vaikka
   * natiivia ei olisi (web) – tällöin ei tehdä mitään.
   */
  async start(role: DeviceRole): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.setState({ available: false, role });
      return;
    }

    try {
      const { available } = await NearbyConnections.isAvailable();
      this.setState({ available, role });
      if (!available) return;

      // Vaihda roolia turvallisesti: pysäytä ja aloita uudelleen.
      await this.stopInternal();

      await NearbyConnections.ensurePermissions();
      await this.attachListeners();

      if (role === 'camera') {
        await NearbyConnections.startAdvertising({ name: this.deviceName, serviceId: SERVICE_ID });
      } else {
        await NearbyConnections.startDiscovery({ name: this.deviceName, serviceId: SERVICE_ID });
      }
      this.started = true;
      this.setState({ status: 'searching', error: null });
      log.info('Lähiyhteys käynnistetty', { role });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Lähiyhteyden käynnistys epäonnistui', msg);
      this.setState({ error: msg });
      // Yritä uudelleen hetken päästä.
      this.scheduleReconnect(role);
    }
  }

  private async attachListeners(): Promise<void> {
    this.pluginListeners.push(
      await NearbyConnections.addListener('statusChanged', (e) => {
        this.setState({ status: e.status, endpointName: e.endpointName ?? null });
        if (e.status === 'connected') this.clearReconnect();
        // Jos yhteys katkeaa, plugin palaa searching-tilaan itse; varmistetaan
        // uudelleenyritys myös TS-puolelta.
        if (e.status === 'disconnected' && this.started && this.state.role) {
          this.scheduleReconnect(this.state.role);
        }
      })
    );

    this.pluginListeners.push(
      await NearbyConnections.addListener('messageReceived', (e) => {
        try {
          const msg = JSON.parse(e.json) as NearbyMessage;
          // Vastaa PING → PONG automaattisesti (yhteyden elävyys).
          if (msg.type === 'PING') void this.sendMessage({ type: 'PONG' });
          this.events.emit('message', msg);
        } catch (err) {
          log.warn('Virheellinen viesti', err);
        }
      })
    );

    this.pluginListeners.push(
      await NearbyConnections.addListener('transferProgress', (e) => {
        this.setState({
          transferFraction: e.done ? null : e.fraction,
          transferDirection: e.done ? null : e.direction,
        });
      })
    );

    this.pluginListeners.push(
      await NearbyConnections.addListener('fileReceived', (e) => {
        try {
          const metadata = JSON.parse(e.metadataJson) as VideoTransferMetadata;
          this.events.emit('fileReceived', { path: e.path, metadata });
        } catch (err) {
          log.warn('Virheelliset tiedoston metatiedot', err);
        }
      })
    );
  }

  /** Lähettää protokollaviestin (jos yhteys on). */
  async sendMessage(message: NearbyMessage): Promise<void> {
    if (!this.state.available || this.state.status !== 'connected') return;
    try {
      await NearbyConnections.sendMessage({ json: JSON.stringify(message) });
    } catch (err) {
      log.warn('Viestin lähetys epäonnistui', err);
    }
  }

  /**
   * Lähettää videotiedoston metatietoineen Viewerille. Palauttaa true jos
   * lähetys aloitettiin. Jos yhteyttä ei ole, palauttaa false (video jää
   * paikallisesti talteen normaalisti).
   */
  async sendVideo(path: string, metadata: VideoTransferMetadata): Promise<boolean> {
    if (!this.state.available || this.state.status !== 'connected') return false;
    try {
      await NearbyConnections.sendFile({ path, metadataJson: JSON.stringify(metadata) });
      log.info('Videon lähetys aloitettu', { recordingId: metadata.recordingId });
      return true;
    } catch (err) {
      log.warn('Videon lähetys epäonnistui', err);
      return false;
    }
  }

  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  private scheduleReconnect(role: DeviceRole): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info('Yritetään yhdistää uudelleen');
      void this.start(role);
    }, 4000);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async stopInternal(): Promise<void> {
    for (const l of this.pluginListeners) await l.remove();
    this.pluginListeners = [];
    if (Capacitor.isNativePlatform()) {
      try {
        await NearbyConnections.stop();
      } catch {
        /* ohitetaan */
      }
    }
  }

  /** Pysäyttää yhteyden kokonaan. */
  async stop(): Promise<void> {
    this.started = false;
    this.clearReconnect();
    await this.stopInternal();
    this.setState({ status: 'disconnected', endpointName: null });
  }
}
