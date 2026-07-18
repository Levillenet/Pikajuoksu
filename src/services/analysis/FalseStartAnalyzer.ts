import { AppConfig } from '@/config';
import type { BodyKeypointGroup, FalseStartAnalysis, LaneAnalysis } from '@/models/types';
import { createLogger } from '@/utils/logger';
import { POSE_LANDMARKS, type DetectedPose, type PoseEngine } from './PoseEngine';

const log = createLogger('FalseStartAnalyzer');

/** Yhden henkilön asennon painopiste ja avainpisteet yhdessä kehyksessä. */
interface FrameSample {
  timestampMs: number;
  poses: DetectedPose[];
}

/** Yhden radan (kilpailijan) aikasarja analyysi-ikkunan sisällä. */
interface LaneTrack {
  lane: number;
  /** Painopisteen x-koordinaatti (ratojen järjestämiseen). */
  centroidX: number;
  /** Havainnot: aikaleima + painopisteet ryhmittäin. */
  samples: Array<{
    timestampMs: number;
    groupCentroids: Record<BodyKeypointGroup, { x: number; y: number } | null>;
  }>;
}

/**
 * FalseStartAnalyzer analysoi tallennetun videon ja etsii jokaisen radan
 * ensimmäisen liikkeen suhteessa starttipistoolin laukaukseen.
 *
 * Kulku:
 *  1) Näytteistä video analyysi-ikkunassa [laukaus - 0,5 s, laukaus + 1,0 s].
 *  2) Tunnista jokaisesta kehyksestä kilpailijoiden asennot (PoseEngine).
 *  3) Ryhmittele havainnot radoiksi vaakasuoran sijainnin perusteella.
 *  4) Laske jokaiselle radalle ensimmäinen liike (avainpisteiden siirtymä).
 *  5) Merkitse rata epäilyttäväksi, jos liike alkaa ennen laukausta tai
 *     epäinhimillisen nopeasti (< 100 ms).
 *
 * Tämä on avustava analyysi, ei virallinen tuomio.
 */
export class FalseStartAnalyzer {
  private readonly cfg = AppConfig.analysis;

  constructor(private readonly engine: PoseEngine) {}

  /**
   * Analysoi videon.
   * @param video  Ladattu ja toistovalmis HTMLVideoElement (metadata luettu).
   * @param gunshotOffsetMs  Laukauksen aikaleima videon alusta (t=0).
   */
  async analyze(video: HTMLVideoElement, gunshotOffsetMs: number): Promise<FalseStartAnalysis> {
    const startMs = Math.max(0, gunshotOffsetMs - this.cfg.windowBeforeMs);
    const endMs = Math.min(video.duration * 1000, gunshotOffsetMs + this.cfg.windowAfterMs);

    const base: FalseStartAnalysis = {
      gunshotOffsetMs,
      windowBeforeMs: this.cfg.windowBeforeMs,
      windowAfterMs: this.cfg.windowAfterMs,
      lanes: [],
      analyzedAtEpochMs: Date.now(),
      engine: this.engine.name,
    };

    try {
      await this.engine.initialize();
    } catch (err) {
      log.error('Pose-moottorin alustus epäonnistui', err);
      return { ...base, note: 'Liikeanalyysi ei ollut käytettävissä (mallia ei voitu ladata).' };
    }

    // 1–2) Näytteistä kehykset ja tunnista asennot.
    const samples = await this.sampleFrames(video, startMs, endMs);
    if (samples.length === 0) {
      return { ...base, note: 'Videosta ei saatu näytteitä analyysi-ikkunassa.' };
    }

    // 3) Ryhmittele radoiksi.
    const tracks = this.buildLaneTracks(samples);
    if (tracks.length === 0) {
      return { ...base, note: 'Yhtään kilpailijaa ei tunnistettu analyysi-ikkunassa.' };
    }

    // 4–5) Laske ensimmäinen liike ja epäilyttävyys jokaiselle radalle.
    const lanes = tracks.map((track) => this.analyzeLane(track, gunshotOffsetMs));
    lanes.sort((a, b) => a.lane - b.lane);

    log.info('Analyysi valmis', {
      lanes: lanes.length,
      suspicious: lanes.filter((l) => l.suspicious).length,
    });
    return { ...base, lanes };
  }

  /** Näytteistää videon kehykset annetulla aikavälillä offscreen-canvasille. */
  private async sampleFrames(video: HTMLVideoElement, startMs: number, endMs: number): Promise<FrameSample[]> {
    const frameStepMs = 1000 / this.cfg.sampleFps;
    const canvas = document.createElement('canvas');
    // Skaalataan alas nopeuttamaan tunnistusta ilman merkittävää tarkkuushävikkiä.
    const targetWidth = 640;
    const scale = targetWidth / (video.videoWidth || targetWidth);
    canvas.width = targetWidth;
    canvas.height = Math.round((video.videoHeight || 360) * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D -kontekstia ei saatu');

    const samples: FrameSample[] = [];
    for (let t = startMs; t <= endMs; t += frameStepMs) {
      await this.seek(video, t / 1000);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let poses: DetectedPose[] = [];
      try {
        poses = this.engine.detect(canvas, t);
      } catch (err) {
        log.warn('Kehyksen tunnistus epäonnistui', { t, err });
      }
      samples.push({ timestampMs: t, poses });
    }
    return samples;
  }

  /** Siirtää videon annettuun kohtaan ja odottaa, että kehys on valmis. */
  private seek(video: HTMLVideoElement, timeSec: number): Promise<void> {
    return new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = timeSec;
    });
  }

  /**
   * Ryhmittelee kehyskohtaiset havainnot radoiksi vaakasuoran painopisteen
   * perusteella. Yksinkertainen lähestymistapa: klusteroi painopisteet
   * ensimmäisistä kehyksistä ja liitä myöhempien kehysten havainnot
   * lähimpään klusteriin.
   */
  private buildLaneTracks(samples: FrameSample[]): LaneTrack[] {
    // Kerää kaikki painopisteet klusterointia varten.
    const centroids: number[] = [];
    for (const sample of samples) {
      for (const pose of sample.poses) {
        centroids.push(this.poseCentroidX(pose));
      }
    }
    if (centroids.length === 0) return [];

    // Arvioi ratojen määrä havaittujen henkilöiden mediaanilukumäärästä.
    const counts = samples.map((s) => s.poses.length).filter((c) => c > 0);
    const laneCount = counts.length > 0 ? this.median(counts) : 1;

    // Alusta klusterikeskukset jakamalla x-alue tasaisesti havaittujen mukaan.
    centroids.sort((a, b) => a - b);
    const clusterCenters: number[] = [];
    for (let i = 0; i < laneCount; i++) {
      const idx = Math.floor(((i + 0.5) / laneCount) * centroids.length);
      clusterCenters.push(centroids[Math.min(idx, centroids.length - 1)]);
    }

    // Luo radat vasemmalta oikealle.
    const tracks: LaneTrack[] = clusterCenters.map((cx, i) => ({
      lane: i + 1,
      centroidX: cx,
      samples: [],
    }));

    // Liitä jokaisen kehyksen havainnot lähimpään rataan (yksi per rata / kehys).
    for (const sample of samples) {
      const used = new Set<number>();
      // Järjestä henkilöt vasemmalta oikealle vakauden vuoksi.
      const ordered = [...sample.poses].sort((a, b) => this.poseCentroidX(a) - this.poseCentroidX(b));
      for (const pose of ordered) {
        const cx = this.poseCentroidX(pose);
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < tracks.length; i++) {
          if (used.has(i)) continue;
          const d = Math.abs(tracks[i].centroidX - cx);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        if (best >= 0) {
          used.add(best);
          tracks[best].samples.push({
            timestampMs: sample.timestampMs,
            groupCentroids: this.groupCentroids(pose),
          });
          // Päivitä radan painopistettä liukuvasti (seuranta).
          tracks[best].centroidX = 0.7 * tracks[best].centroidX + 0.3 * cx;
        }
      }
    }

    return tracks.filter((t) => t.samples.length >= 2);
  }

  /** Analysoi yhden radan aikasarjan: ensimmäinen liike ja epäilyttävyys. */
  private analyzeLane(track: LaneTrack, gunshotOffsetMs: number): LaneAnalysis {
    // Järjestä havainnot ajallisesti.
    const samples = [...track.samples].sort((a, b) => a.timestampMs - b.timestampMs);

    // Perustaso = keskiarvopositio ennen laukausta (tai ensimmäiset kehykset).
    const preShot = samples.filter((s) => s.timestampMs < gunshotOffsetMs);
    const baselineSamples = preShot.length >= 2 ? preShot : samples.slice(0, 2);
    const baseline = this.averageGroupCentroids(baselineSamples);

    let firstMovementMs: number | null = null;
    const triggeringGroups: BodyKeypointGroup[] = [];
    let consecutive = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    const groups: BodyKeypointGroup[] = ['head', 'arms', 'torso', 'hips', 'legs'];

    for (const sample of samples) {
      const movedGroups: BodyKeypointGroup[] = [];
      for (const group of groups) {
        const cur = sample.groupCentroids[group];
        const base = baseline[group];
        if (!cur || !base) continue;
        const dist = Math.hypot(cur.x - base.x, cur.y - base.y);
        if (dist >= this.cfg.movementThreshold) movedGroups.push(group);
      }

      if (movedGroups.length > 0) {
        consecutive++;
        if (consecutive >= this.cfg.consecutiveFrames && firstMovementMs === null) {
          // Ensimmäinen liike = ensimmäisen ylittävän kehyksen aikaleima.
          firstMovementMs = sample.timestampMs;
          for (const g of movedGroups) if (!triggeringGroups.includes(g)) triggeringGroups.push(g);
        }
      } else {
        consecutive = 0;
      }
      confidenceSum += this.averageVisibility(sample.groupCentroids);
      confidenceCount++;
    }

    const relative = firstMovementMs !== null ? firstMovementMs - gunshotOffsetMs : null;
    const reactionTime = relative !== null && relative >= 0 ? relative : null;

    // Epäilyttävä, jos liike alkoi ennen laukausta TAI epäinhimillisen nopeasti.
    const suspicious =
      relative !== null && (relative < 0 || relative < this.cfg.minHumanReactionMs);

    return {
      lane: track.lane,
      firstMovementRelativeToShotMs: relative,
      reactionTimeMs: reactionTime,
      suspicious,
      triggeringGroups,
      confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    };
  }

  // ---- Apufunktiot ----

  private poseCentroidX(pose: DetectedPose): number {
    let sum = 0;
    let count = 0;
    for (const lm of pose.landmarks) {
      if (lm.visibility > 0.2) {
        sum += lm.x;
        count++;
      }
    }
    return count > 0 ? sum / count : 0.5;
  }

  private groupCentroids(pose: DetectedPose): Record<BodyKeypointGroup, { x: number; y: number } | null> {
    const result = {} as Record<BodyKeypointGroup, { x: number; y: number } | null>;
    (Object.keys(POSE_LANDMARKS) as BodyKeypointGroup[]).forEach((group) => {
      const indices = POSE_LANDMARKS[group];
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const idx of indices) {
        const lm = pose.landmarks[idx];
        if (lm && lm.visibility > 0.2) {
          sx += lm.x;
          sy += lm.y;
          count++;
        }
      }
      result[group] = count > 0 ? { x: sx / count, y: sy / count } : null;
    });
    return result;
  }

  private averageGroupCentroids(
    samples: LaneTrack['samples']
  ): Record<BodyKeypointGroup, { x: number; y: number } | null> {
    const groups: BodyKeypointGroup[] = ['head', 'arms', 'torso', 'hips', 'legs'];
    const result = {} as Record<BodyKeypointGroup, { x: number; y: number } | null>;
    for (const group of groups) {
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const s of samples) {
        const c = s.groupCentroids[group];
        if (c) {
          sx += c.x;
          sy += c.y;
          count++;
        }
      }
      result[group] = count > 0 ? { x: sx / count, y: sy / count } : null;
    }
    return result;
  }

  private averageVisibility(groupCentroids: Record<BodyKeypointGroup, { x: number; y: number } | null>): number {
    const values = Object.values(groupCentroids);
    const present = values.filter((v) => v !== null).length;
    return present / values.length;
  }

  private median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
}
