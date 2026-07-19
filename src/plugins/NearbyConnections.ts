import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Natiivin Nearby Connections -pluginin TS-rajapinta.
 *
 * Toteutus on Kotlinissa (plugins/nearby/android). Web-alustalla käytetään
 * varamallia (NearbyConnectionsWeb), joka ilmoittaa ettei ominaisuus ole
 * käytettävissä – näin nykyinen web-/kehityskäyttö toimii ennallaan.
 */

export type NearbyStatus = 'disconnected' | 'searching' | 'connected';

export interface NearbyStatusEvent {
  status: NearbyStatus;
  /** Yhdistetyn vastapuolen nimi, jos tiedossa. */
  endpointName?: string;
}

export interface NearbyMessageEvent {
  /** JSON-merkkijono (NearbyMessage). */
  json: string;
}

export interface NearbyProgressEvent {
  bytesTransferred: number;
  totalBytes: number;
  fraction: number;
  done: boolean;
  direction: 'incoming' | 'outgoing';
}

export interface NearbyFileReceivedEvent {
  /** Vastaanotetun tiedoston paikallinen polku (natiivi URI tai tiedostopolku). */
  path: string;
  /** Mukana tulleet metatiedot JSON-merkkijonona (VideoTransferMetadata). */
  metadataJson: string;
}

export interface NearbyConnectionsPlugin {
  /** Onko natiivi Nearby käytettävissä tällä alustalla. */
  isAvailable(): Promise<{ available: boolean }>;

  /** Pyytää tarvittavat käyttöoikeudet (sijainti, bluetooth, wifi). */
  ensurePermissions(): Promise<{ granted: boolean }>;

  /** Camera-rooli: aloita mainostaminen (Advertising). */
  startAdvertising(options: { name: string; serviceId: string }): Promise<void>;

  /** Viewer-rooli: aloita etsintä (Discovery). */
  startDiscovery(options: { name: string; serviceId: string }): Promise<void>;

  /** Pysäytä kaikki yhteystoiminnot. */
  stop(): Promise<void>;

  /** Lähetä lyhyt viesti (BYTES) yhdistetylle vastapuolelle. */
  sendMessage(options: { json: string }): Promise<void>;

  /** Lähetä tiedosto (FILE) metatietojen kera. */
  sendFile(options: { path: string; metadataJson: string }): Promise<void>;

  /** Nykyinen tila. */
  getStatus(): Promise<NearbyStatusEvent>;

  addListener(eventName: 'statusChanged', listener: (e: NearbyStatusEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'messageReceived', listener: (e: NearbyMessageEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'transferProgress', listener: (e: NearbyProgressEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'fileReceived', listener: (e: NearbyFileReceivedEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

/** Web-varamalli: ominaisuus ei ole käytettävissä selaimessa. */
class NearbyConnectionsWeb implements NearbyConnectionsPlugin {
  async isAvailable() {
    return { available: false };
  }
  async ensurePermissions() {
    return { granted: false };
  }
  async startAdvertising() {
    /* ei tuettu webissä – ei virhettä, jotta muu sovellus toimii */
  }
  async startDiscovery() {
    /* ei tuettu webissä */
  }
  async stop() {
    /* ei tuettu webissä */
  }
  async sendMessage() {
    /* ei tuettu webissä */
  }
  async sendFile() {
    /* ei tuettu webissä */
  }
  async getStatus(): Promise<NearbyStatusEvent> {
    return { status: 'disconnected' };
  }
  async addListener(): Promise<PluginListenerHandle> {
    // Palauta no-op kahva.
    return { remove: async () => undefined };
  }
  async removeAllListeners() {
    /* ei mitään */
  }
}

export const NearbyConnections = registerPlugin<NearbyConnectionsPlugin>('NearbyConnections', {
  web: () => new NearbyConnectionsWeb(),
});
