import { AudioDetectionService } from './audio/AudioDetectionService';
import { AudioProfileStore } from './audio/AudioProfileStore';
import { CalibrationService } from './audio/CalibrationService';
import { RecordingRepository } from './storage/RecordingRepository';
import { StorageService } from './storage/StorageService';
import { MultiCameraSyncService } from './sync/MultiCameraSyncService';
import { FalseStartAnalyzer } from './analysis/FalseStartAnalyzer';
import { MediaPipePoseEngine } from './analysis/MediaPipePoseEngine';
import type { PoseEngine } from './analysis/PoseEngine';

/**
 * ServiceContainer on kevyt riippuvuusinjektiosäiliö. Se rakentaa ja jakaa
 * sovelluksen palvelut, jotta ViewModelit saavat riippuvuutensa
 * konstruktorin kautta (helppo testattavuus ja vaihdettavuus).
 *
 * Pose-moottori luodaan tehdasfunktiolla, joten sen voi vaihtaa (MediaPipe →
 * ML Kit / OpenCV) muuttamatta muuta koodia.
 */
export class ServiceContainer {
  readonly storage = new StorageService();
  readonly repository = new RecordingRepository(this.storage);
  readonly audio = new AudioDetectionService();
  readonly sync = new MultiCameraSyncService();
  /** Opetettujen ääniprofiilien tallennus (pilli + pistooli). */
  readonly profiles = new AudioProfileStore();
  /** Äänten opettaminen (kalibrointi). */
  readonly calibration = new CalibrationService();

  /** Tehdas pose-moottorille (oletuksena MediaPipe). Vaihdettavissa. */
  createPoseEngine(): PoseEngine {
    return new MediaPipePoseEngine({ maxPoses: 8 });
  }

  /** Luo varaslähtöanalysaattorin valitulla pose-moottorilla. */
  createAnalyzer(): FalseStartAnalyzer {
    return new FalseStartAnalyzer(this.createPoseEngine());
  }
}

// Sovelluksen laajuinen jaettu instanssi.
export const container = new ServiceContainer();
