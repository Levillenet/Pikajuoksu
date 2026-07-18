import { createLogger } from '@/utils/logger';
import type { DetectedPose, PoseEngine } from './PoseEngine';

const log = createLogger('MediaPipePose');

/**
 * PoseEngine-toteutus MediaPipe Tasks Vision -kirjastolla (@mediapipe/tasks-vision).
 *
 * Tunnistaa useita henkilöitä samasta kuvasta (numPoses), mikä on tärkeää,
 * koska lähdössä on useita kilpailijoita rinnakkain. Mallit ladataan
 * lazy-periaatteella vasta kun analyysia tarvitaan → nopea sovelluksen
 * käynnistys ja pienempi akunkulutus.
 *
 * Mallitiedostot ladataan oletuksena Google Storage/CDN:stä. Tuotannossa ne
 * kannattaa niputtaa sovelluksen mukaan offline-käyttöä varten (ks. README).
 */

/** Mallien ja wasm-tiedostojen lähteet (voidaan ohittaa offline-nipulla). */
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export class MediaPipePoseEngine implements PoseEngine {
  readonly name = 'mediapipe-pose';

  // Käytämme dynaamista importtia ja väljää tyypitystä, jotta rakennus ei
  // kaadu jos natiivipuolella käytetään eri moottoria.
  private landmarker: { detectForVideo: (image: CanvasImageSource, ts: number) => unknown; close: () => void } | null =
    null;
  private initializing: Promise<void> | null = null;

  constructor(
    private readonly options: {
      maxPoses?: number;
      wasmRoot?: string;
      modelUrl?: string;
    } = {}
  ) {}

  async initialize(): Promise<void> {
    if (this.landmarker) return;
    // Estä kilpa-alustus rinnakkaisilla kutsuilla.
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, PoseLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks(this.options.wasmRoot ?? WASM_ROOT);
        this.landmarker = (await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this.options.modelUrl ?? MODEL_URL,
            delegate: 'GPU', // GPU-kiihdytys, jos saatavilla → nopeampi analyysi.
          },
          runningMode: 'VIDEO',
          numPoses: this.options.maxPoses ?? 8, // Enintään 8 rataa.
          minPoseDetectionConfidence: 0.4,
          minTrackingConfidence: 0.4,
        })) as unknown as typeof this.landmarker;
        log.info('MediaPipe Pose alustettu');
      } catch (err) {
        log.error('MediaPipe Posen alustus epäonnistui', err);
        throw err;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  detect(image: CanvasImageSource, timestampMs: number): DetectedPose[] {
    if (!this.landmarker) {
      throw new Error('MediaPipePoseEngine: initialize() on kutsuttava ennen detect()');
    }
    // MediaPipe vaatii kasvavan aikaleiman (kokonaisluku ms).
    const result = this.landmarker.detectForVideo(image, Math.round(timestampMs)) as {
      landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>>;
    };

    const poses: DetectedPose[] = [];
    for (const personLandmarks of result.landmarks ?? []) {
      poses.push({
        landmarks: personLandmarks.map((lm) => ({
          x: lm.x,
          y: lm.y,
          visibility: lm.visibility ?? 1,
        })),
      });
    }
    return poses;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
