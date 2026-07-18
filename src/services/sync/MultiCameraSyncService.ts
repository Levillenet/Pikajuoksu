import type { CameraSource } from '@/models/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('MultiCameraSync');

/** Yhden kameran ajallinen kohdistus yhteiselle aikajanalle. */
export interface CameraAlignment {
  sourceId: string;
  /**
   * Siirtymä (ms), joka lisätään tämän kameran omaan aikaan, jotta se on
   * yhteisellä aikajanalla. Yhteinen nollakohta = starttipistoolin laukaus.
   */
  offsetToCommonMs: number;
  /** Onko kohdistus luotettava (laukaus löytyi videosta). */
  aligned: boolean;
}

/**
 * MultiCameraSyncService synkronoi usean kameran videot automaattisesti
 * starttipistoolin äänen perusteella.
 *
 * Periaate: jokainen kamera tunnistaa saman laukauksen omalta ääniraidaltaan.
 * Koska laukaus on fyysisesti sama tapahtuma, sen offset kussakin videossa
 * antaa suoraan kameroiden välisen aikaeron. Kun kaikki videot kohdistetaan
 * laukaushetkeen (t=0), ne ovat samalla aikajanalla, ja tekoäly voi analysoida
 * lähtöä useasta kuvakulmasta.
 *
 * Tämä palvelu on mukana jo ensimmäisessä versiossa, jotta arkkitehtuuri
 * tukee usean kameran laajennusta ilman uudelleenkirjoitusta. V1:ssä
 * lähteitä on tyypillisesti yksi.
 */
export class MultiCameraSyncService {
  /**
   * Laskee kohdistukset kaikille kameroille. Yhteinen nollakohta on
   * laukaushetki, joten offsetToCommon = -gunshotOffset kussakin videossa.
   */
  computeAlignments(sources: CameraSource[]): CameraAlignment[] {
    return sources.map((source) => {
      const hasShot = source.gunshotOffsetMs !== null;
      return {
        sourceId: source.sourceId,
        // Kun video siirretään niin, että laukaus on kohdassa 0, jokaisen
        // kameran oma aika t muuntuu yhteiseksi ajaksi (t - gunshotOffset).
        offsetToCommonMs: hasShot ? -(source.gunshotOffsetMs as number) : 0,
        aligned: hasShot,
      };
    });
  }

  /**
   * Muuntaa yhden kameran oman ajan (ms sen videon alusta) yhteiseksi
   * aikajana-ajaksi (ms laukauksesta).
   */
  toCommonTime(source: CameraSource, localMs: number): number {
    const offset = source.gunshotOffsetMs ?? 0;
    return localMs - offset;
  }

  /**
   * Muuntaa yhteisen aikajana-ajan (ms laukauksesta) tietyn kameran omaksi
   * ajaksi. Käytetään esim. haluttaessa näyttää sama hetki kaikista kulmista.
   */
  toLocalTime(source: CameraSource, commonMs: number): number {
    const offset = source.gunshotOffsetMs ?? 0;
    return commonMs + offset;
  }

  /**
   * Yhdistää usean kameran kohdistukset ja arvioi synkronoinnin laadun.
   * Palauttaa varoituksen, jos jokin kamera ei löytänyt laukausta.
   */
  validateSync(sources: CameraSource[]): { ok: boolean; message?: string } {
    const missing = sources.filter((s) => s.gunshotOffsetMs === null);
    if (missing.length === 0) return { ok: true };
    const message = `Synkronointi epävarma: ${missing.length}/${sources.length} kameraa ei tunnistanut laukausta.`;
    log.warn(message);
    return { ok: false, message };
  }
}
