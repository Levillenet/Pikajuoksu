import { createLogger } from '@/utils/logger';

const log = createLogger('CameraZoom');

/** Kameran zoom-kyvyt luettuna videoraidan capabilities-tiedoista. */
export interface ZoomCapability {
  /** Tukeeko laite/selain zoomin säätöä lainkaan. */
  supported: boolean;
  /** Pienin zoom-arvo (esim. 0.5 = laajakulma/ultrawide). */
  min: number;
  /** Suurin zoom-arvo. */
  max: number;
  /** Askelväli. */
  step: number;
  /** Nykyinen zoom-arvo. */
  current: number;
  /**
   * Valmiit valittavat zoom-tasot laitteen rajojen mukaan (esim. [1, 2]).
   * "Puhelimen asettelun mukaan" – rakennetaan dynaamisesti min/max-alueesta.
   */
  presets: number[];
}

/**
 * Standardiin kuulumaton zoom-rajapinta ei ole DOM-tyypeissä, joten
 * käytämme väljää tyyppiä capabilities/settings/constraints-kentille.
 */
interface ZoomCapabilities {
  zoom?: { min: number; max: number; step: number };
}
interface ZoomSettings {
  zoom?: number;
}

/**
 * CameraZoomController hallitsee takakameran zoom-tasoa.
 *
 * Monet puhelimet valitsevat facingMode:'environment' -pyynnölle oletuksena
 * laajakulmalinssin (esim. 0.6×). Tämä ohjain lukee laitteen tukemat
 * zoom-rajat ja mahdollistaa halutun tason valinnan – oletuksena 1× (normaali
 * kuvakulma) laajakulman sijaan. Tuetut tasot riippuvat laitteesta.
 */
export class CameraZoomController {
  private track: MediaStreamTrack | null = null;

  /** Liittää ohjaimen striimin videoraitaan. */
  attach(stream: MediaStream): void {
    this.track = stream.getVideoTracks()[0] ?? null;
  }

  /** Lukee laitteen zoom-kyvyt. Palauttaa supported:false jos ei tuettu. */
  getCapability(): ZoomCapability {
    const fallback: ZoomCapability = {
      supported: false,
      min: 1,
      max: 1,
      step: 0.1,
      current: 1,
      presets: [1],
    };
    if (!this.track || typeof this.track.getCapabilities !== 'function') return fallback;

    const caps = this.track.getCapabilities() as MediaTrackCapabilities & ZoomCapabilities;
    const zoom = caps.zoom;
    if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number' || zoom.max <= zoom.min) {
      return fallback;
    }

    const settings = this.track.getSettings() as MediaTrackSettings & ZoomSettings;
    const current = settings.zoom ?? 1;

    return {
      supported: true,
      min: zoom.min,
      max: zoom.max,
      step: zoom.step || 0.1,
      current,
      presets: this.buildPresets(zoom.min, zoom.max),
    };
  }

  /**
   * Rakentaa valittavat zoom-tasot laitteen rajojen mukaan. Käytetään yleisiä
   * kiintopisteitä (0.6×, 1×, 2×, 3×, 5×) ja karsitaan ne, jotka eivät mahdu
   * laitteen [min, max]-alueeseen. 1× sisällytetään aina (rajattuna).
   */
  private buildPresets(min: number, max: number): number[] {
    const candidates = [0.6, 1, 2, 3, 5, 10];
    const inRange = candidates.filter((v) => v >= min - 0.001 && v <= max + 0.001);
    // Varmista, että 1× (tai lähin sallittu) on mukana.
    const one = Math.min(Math.max(1, min), max);
    if (!inRange.some((v) => Math.abs(v - one) < 0.01)) inRange.push(one);
    // Varmista min ja max päätepisteet, jos ne poikkeavat selvästi.
    if (!inRange.some((v) => Math.abs(v - min) < 0.01)) inRange.unshift(min);
    if (!inRange.some((v) => Math.abs(v - max) < 0.01)) inRange.push(max);
    // Järjestä ja poista duplikaatit (pyöristettynä).
    const unique = Array.from(new Set(inRange.map((v) => Math.round(v * 10) / 10)));
    return unique.sort((a, b) => a - b);
  }

  /**
   * Asettaa zoom-tason. Yritetään soveltaa vaikka laite ei ilmoittaisi
   * zoom-kykyä getCapabilities-rajapinnan kautta – osa Android-WebView'sta
   * tukee zoomia silti. Jos laite ei tue, kutsu on vaaraton no-op.
   */
  async setZoom(value: number): Promise<number> {
    if (!this.track) return value;
    const cap = this.getCapability();
    // Rajaa laitteen alueeseen, tai varovaiseen 1–8× jos kykyä ei ilmoiteta.
    const min = cap.supported ? cap.min : 1;
    const max = cap.supported ? cap.max : 8;
    const clamped = Math.max(min, Math.min(max, value));
    try {
      // advanced-kenttä on laajimmin tuettu tapa asettaa zoom.
      await this.track.applyConstraints({ advanced: [{ zoom: clamped } as unknown as MediaTrackConstraintSet] });
      log.info('Zoom asetettu', { zoom: clamped });
    } catch (err) {
      log.warn('Zoomin asetus epäonnistui (laite ei ehkä tue zoomia)', err);
    }
    return clamped;
  }

  /**
   * Asettaa oletuszoomin 1×:ään (normaali kuvakulma) laajakulman sijaan.
   * Yritetään aina, koska juuri laajakulmaoletus on ongelma.
   */
  async applyDefaultZoom(): Promise<number> {
    return this.setZoom(1);
  }

  /**
   * Palauttaa käyttöliittymään näytettävät zoom-tasot. Jos laite ilmoittaa
   * oikeat rajat, käytetään niitä; muuten tarjotaan yleiset tasot (1×, 2×, 3×)
   * ja yritetään soveltaa niitä silti.
   */
  getPresetsForUi(): number[] {
    const cap = this.getCapability();
    if (cap.supported && cap.presets.length > 1) return cap.presets;
    return [1, 2, 3];
  }

  detach(): void {
    this.track = null;
  }
}
