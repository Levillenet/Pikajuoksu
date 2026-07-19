/**
 * Lähiyhteyden (Nearby Connections) domain-mallit: laiterooli, yhteyden tila
 * ja viestiprotokolla.
 *
 * Sama sovellus toimii kahdessa roolissa:
 *  - Camera: kuvaava puhelin (Advertiser) – lähettää videot.
 *  - Viewer: lähettäjän/erotuomarin puhelin (Discoverer) – vastaanottaa videot.
 *
 * Kaikki varsinainen yhteyskoodi on natiivipluginissa ja sitä käärivässä
 * ConnectionManagerissa – muu sovellus käyttää vain näitä tyyppejä.
 */

/** Laitteen rooli lähiyhteydessä. */
export type DeviceRole = 'camera' | 'viewer';

/** Yhteyden tila (UI-kuvake: punainen/keltainen/vihreä). */
export type ConnectionState =
  | 'disconnected' // 🔴 ei yhteyttä
  | 'searching' // 🟡 mainostaa/etsii/yhdistää
  | 'connected'; // 🟢 vastapuoli yhdistetty

/**
 * Viestiprotokollan tyypit. Osa on varattu tulevia Viewer-toimintoja varten,
 * mutta rajapinta rakennetaan valmiiksi.
 */
export type NearbyMessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'NEW_VIDEO_AVAILABLE'
  | 'VIDEO_TRANSFER'
  | 'STATUS'
  | 'PING'
  | 'PONG';

/** Videon metatiedot, jotka lähetetään videotiedoston mukana. */
export interface VideoTransferMetadata {
  /** Alkuperäisen tallenteen id. */
  recordingId: string;
  competition: string;
  /** Erä (esim. alkuerä 1). Vapaaehtoinen. */
  heat?: string;
  /** Rata. Vapaaehtoinen. */
  lane?: number;
  createdAtEpochMs: number;
  durationMs: number;
  /** Tiedoston koko tavuina. */
  fileSizeBytes: number;
  mimeType: string;
  /** Laukauksen offset (ms) videon alusta, jos tunnistettu. */
  gunshotOffsetMs: number | null;
}

/** Yleinen viesti (BYTES-hyötykuorma). */
export interface NearbyMessage {
  type: NearbyMessageType;
  /** Vapaa hyötykuorma tyypin mukaan (esim. STATUS, tai VIDEO_TRANSFER-metatiedot). */
  payload?: unknown;
}

/** Tiedostonsiirron etenemistieto. */
export interface TransferProgress {
  /** Siirretyt tavut. */
  bytesTransferred: number;
  /** Kokonaiskoko tavuina (tai -1 jos tuntematon). */
  totalBytes: number;
  /** Eteneminen 0..1. */
  fraction: number;
  /** Onko siirto valmis. */
  done: boolean;
  /** Suunta. */
  direction: 'incoming' | 'outgoing';
}
