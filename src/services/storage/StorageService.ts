import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { AppConfig } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('Storage');

/**
 * StorageService tallentaa videotiedostot laitteen muistiin ja tarjoaa
 * toistokelpoiset URL:t. Käyttää Capacitor Filesystemiä, joka toimii sekä
 * natiivilla (Android/iOS) että webissä (IndexedDB-taustainen toteutus).
 *
 * Video tallennetaan aina automaattisesti – käyttäjän ei tarvitse tehdä mitään.
 */
export class StorageService {
  private readonly dir = Directory.Data;
  private readonly folder = AppConfig.storage.directory;

  /** Varmistaa, että tallennuskansio on olemassa. */
  private async ensureDir(): Promise<void> {
    try {
      await Filesystem.mkdir({ path: this.folder, directory: this.dir, recursive: true });
    } catch {
      // Kansio on todennäköisesti jo olemassa – ei virhe.
    }
  }

  /** Muuntaa Blobin base64-merkkijonoksi (ilman data-URL-etuliitettä). */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Tallentaa videon Blobin tiedostoon. Palauttaa suhteellisen polun,
   * jota käytetään myöhemmin toistoon ja jakamiseen.
   */
  async saveVideo(id: string, blob: Blob, mimeType: string): Promise<string> {
    await this.ensureDir();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const path = `${this.folder}/${id}.${ext}`;
    const base64 = await this.blobToBase64(blob);
    await Filesystem.writeFile({ path, directory: this.dir, data: base64 });
    log.info('Video tallennettu', { path, bytes: blob.size });
    return path;
  }

  /**
   * Palauttaa toistokelpoisen URL:n videolle.
   * Natiivilla käytetään convertFileSrc-osoitetta (tehokas, streamaa suoraan).
   * Webissä luetaan tiedosto ja luodaan blob-URL.
   */
  async getPlayableUrl(path: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.getUri({ path, directory: this.dir });
      return Capacitor.convertFileSrc(uri);
    }
    // Web: lue base64 ja rakenna blob-URL.
    const result = await Filesystem.readFile({ path, directory: this.dir });
    const base64 = result.data as string;
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const mime = path.endsWith('mp4') ? 'video/mp4' : 'video/webm';
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }

  /** Palauttaa tiedoston natiivin URI:n jakamista varten. */
  async getFileUri(path: string): Promise<string> {
    const { uri } = await Filesystem.getUri({ path, directory: this.dir });
    return uri;
  }

  /** Poistaa videotiedoston. */
  async deleteVideo(path: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path, directory: this.dir });
      log.info('Video poistettu', { path });
    } catch (err) {
      log.warn('Videon poisto epäonnistui (tiedostoa ei ehkä ole)', err);
    }
  }

  /** Lukee kirjaston metadatan (JSON) – pysyy laitteessa uudelleenkäynnistyksen yli. */
  async readLibraryJson(): Promise<string | null> {
    try {
      const result = await Filesystem.readFile({
        path: `${this.folder}/library.json`,
        directory: this.dir,
        encoding: Encoding.UTF8,
      });
      return result.data as string;
    } catch {
      return null; // Ensimmäinen käynnistys – kirjastoa ei vielä ole.
    }
  }

  /** Kirjoittaa kirjaston metadatan. */
  async writeLibraryJson(json: string): Promise<void> {
    await this.ensureDir();
    await Filesystem.writeFile({
      path: `${this.folder}/library.json`,
      directory: this.dir,
      data: json,
      encoding: Encoding.UTF8,
    });
  }
}
