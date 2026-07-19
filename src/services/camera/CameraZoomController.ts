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

  /** Asettaa zoom-tason (rajataan laitteen sallimaan alueeseen). */
  async setZoom(value: number): Promise<number> {
    if (!this.track) return value;
    const cap = this.getCapability();
    if (!cap.supported) return value;
    const clamped = Math.max(cap.min, Math.min(cap.max, value));
    try {
      // advanced-kenttä on laajimmin tuettu tapa asettaa zoom.
      await this.track.applyConstraints({ advanced: [{ zoom: clamped } as unknown as MediaTrackConstraintSet] });
      log.info('Zoom asetettu', { zoom: clamped });
    } catch (err) {
      log.warn('Zoomin asetus epäonnistui', err);
    }
    return clamped;
  }

  /**
   * Asettaa oletuszoomin. Jos laite tukee zoomia ja sallii 1×, valitaan 1×
   * (normaali kuvakulma) laajakulman sijaan. Palauttaa käytetyn arvon.
   */
  async applyDefaultZoom(): Promise<number> {
    const cap = this.getCapability();
    if (!cap.supported) return cap.current;
    const desired = Math.min(Math.max(1, cap.min), cap.max);
    return this.setZoom(desired);
  }

  detach(): void {
    this.track = null;
  }
}
