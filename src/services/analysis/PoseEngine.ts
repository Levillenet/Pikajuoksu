/**
 * PoseEngine on abstraktio kehon asennon tunnistamiselle. Konkreettinen
 * toteutus voi käyttää MediaPipe Posea, ML Kitiä tai OpenCV:tä. Analyysilogiikka
 * (FalseStartAnalyzer) riippuu vain tästä rajapinnasta, joten moottorin voi
 * vaihtaa ilman muutoksia analyysiin.
 */

/** Yksittäinen kehon avainpiste normalisoiduissa kuvakoordinaateissa (0..1). */
export interface Landmark {
  x: number;
  y: number;
  /** Näkyvyys/luottamus 0..1 (jos moottori tarjoaa). */
  visibility: number;
}

/** Yhden havaitun henkilön (kilpailijan) asento yhdessä kuvassa. */
export interface DetectedPose {
  /** Avainpisteet. Indeksointi noudattaa MediaPipe Pose -konventiota (33 pistettä). */
  landmarks: Landmark[];
}

/** Yhden kuvakehyksen tunnistustulos. */
export interface PoseFrame {
  /** Aika tallenteen alusta (ms). */
  timestampMs: number;
  /** Kaikki havaitut henkilöt tässä kehyksessä. */
  poses: DetectedPose[];
}

export interface PoseEngine {
  /** Nimi lokitusta/metadataa varten (esim. "mediapipe-pose"). */
  readonly name: string;
  /** Alustaa moottorin (lataa mallit). Turvallista kutsua useasti. */
  initialize(): Promise<void>;
  /**
   * Tunnistaa asennot yhdestä kuvasta.
   * @param image  Lähdekuva (video-frame tai canvas).
   * @param timestampMs  Kehyksen aikaleima (kasvava, vaaditaan videostreamille).
   */
  detect(image: CanvasImageSource, timestampMs: number): DetectedPose[];
  /** Vapauttaa resurssit. */
  close(): void;
}

/**
 * MediaPipe Pose -avainpisteiden indeksit, joita tarvitsemme liikeanalyysissä.
 * Ryhmittely vastaa domain-mallin BodyKeypointGroup-arvoja.
 */
export const POSE_LANDMARKS = {
  head: [0], // nenä
  arms: [11, 12, 13, 14, 15, 16], // olkapäät, kyynärpäät, ranteet
  torso: [11, 12, 23, 24], // olkapäät + lonkat (vartalon runko)
  hips: [23, 24], // lonkat
  legs: [25, 26, 27, 28], // polvet, nilkat
} as const;
