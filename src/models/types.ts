/**
 * Domain-mallit (MVVM: Model-kerros).
 *
 * Nämä tyypit kuvaavat sovelluksen keskeiset käsitteet: äänitapahtumat,
 * tallenteet ja varaslähtöanalyysin tulokset. Ne ovat puhdasta dataa
 * ilman UI- tai laiteriippuvuuksia, joten ne ovat helposti testattavissa
 * ja jaettavissa myös tulevan usean kameran synkronoinnin kanssa.
 */

/** Tunnistetun äänitapahtuman tyyppi. */
export type AudioEventType = 'whistle' | 'gunshot';

/** Yksittäinen mikrofonista tunnistettu äänitapahtuma. */
export interface AudioEvent {
  type: AudioEventType;
  /** Monotoninen aikaleima (performance.now) havaintohetkellä. */
  monotonicMs: number;
  /** Seinäkelloaika (Date.now) lokitusta ja synkronointia varten. */
  epochMs: number;
  /** Tunnistuksen luottamus 0..1. */
  confidence: number;
  /**
   * Aikaleima suhteessa tallennuksen alkuun (ms). Täytetään, kun tapahtuma
   * liittyy käynnissä olevaan tallenteeseen. Tämä on videon "aikajana-arvo".
   */
  offsetFromRecordingStartMs?: number;
}

/** Kehon avainpisteet, joita pose-analyysi seuraa. */
export type BodyKeypointGroup = 'head' | 'arms' | 'torso' | 'hips' | 'legs';

/** Yksittäisen radan (kilpailijan) analyysitulos. */
export interface LaneAnalysis {
  /** Radan numero (1..8). */
  lane: number;
  /**
   * Ensimmäisen havaitun liikkeen ajankohta suhteessa laukaisuhetkeen (ms).
   * Negatiivinen = liike alkoi ennen laukausta (mahdollinen varaslähtö).
   */
  firstMovementRelativeToShotMs: number | null;
  /**
   * Reaktioaika (ms) = firstMovement, kun se on positiivinen.
   * Alle ~100 ms reaktioaikaa pidetään ihmiselle mahdottomana → epäilyttävä.
   */
  reactionTimeMs: number | null;
  /** Onko rata merkitty epäilyttäväksi. */
  suspicious: boolean;
  /** Mitkä kehonosat liikkuivat ensimmäisenä (diagnostiikkaa varten). */
  triggeringGroups: BodyKeypointGroup[];
  /** Analyysin luottamus 0..1 (esim. kuinka luotettavasti pose havaittiin). */
  confidence: number;
}

/** Koko lähdön varaslähtöanalyysin kooste. */
export interface FalseStartAnalysis {
  /** Analyysin nollakohta = starttipistoolin laukaus (ms tallenteen alusta). */
  gunshotOffsetMs: number;
  /** Analysoitu aikaikkuna suhteessa laukaukseen. */
  windowBeforeMs: number;
  windowAfterMs: number;
  lanes: LaneAnalysis[];
  /** Analyysin ajohetki. */
  analyzedAtEpochMs: number;
  /** Käytetty pose-moottori (esim. "mediapipe-pose"). */
  engine: string;
  /** Vapaamuotoinen huomautus, esim. jos analyysi epäonnistui osittain. */
  note?: string;
}

/**
 * Yhden kameran tuottama videovirta osana lähtöä. Ensimmäisessä versiossa
 * lähdössä on yksi lähde, mutta rakenne tukee jo useaa kameraa
 * (multi-camera): jokaisella on oma tiedosto ja oma laukaus-offset.
 */
export interface CameraSource {
  /** Yksilöivä tunniste (esim. laite- tai istunto-id). */
  sourceId: string;
  /** Ihmisluettava nimi, esim. "Puhelin A" tai "Rata 1–4". */
  label: string;
  /** Tallennetun videotiedoston viittaus (Filesystem-polku tai blob-URI). */
  videoPath: string;
  /** MIME-tyyppi (esim. video/mp4 tai video/webm). */
  mimeType: string;
  /** Videon kesto millisekunteina. */
  durationMs: number;
  /** Laukauksen offset tässä nimenomaisessa videossa (synkronointia varten). */
  gunshotOffsetMs: number | null;
}

/**
 * Lähtötallenne = looginen kokonaisuus, joka voi sisältää yhden tai
 * useamman kameran videon. Tämä on kirjaston perusyksikkö.
 */
export interface StartRecording {
  id: string;
  /** Tallennuksen aloitushetki (seinäkelloaika). */
  createdAtEpochMs: number;
  /** Kilpailun/erän nimi (käyttäjän tai oletusarvon mukaan). */
  competition: string;
  /** Ensisijainen (referenssi-)kamera, jonka aikajanaan analyysi perustuu. */
  primarySourceId: string;
  /** Kaikki kameralähteet (≥1). */
  sources: CameraSource[];
  /** Pillin havaintohetki (offset ei relevantti, mutta säilytetään lokina). */
  whistleDetectedEpochMs: number | null;
  /** Laukauksen tapahtuma referenssikamerassa. */
  gunshot: AudioEvent | null;
  /** Varaslähtöanalyysi, jos se on ajettu. */
  analysis: FalseStartAnalysis | null;
}

/** Kevyt kirjastonäkymä listaa varten (ei raskaita kenttiä). */
export interface RecordingSummary {
  id: string;
  createdAtEpochMs: number;
  competition: string;
  /** Referenssikameran kesto. */
  durationMs: number;
  cameraCount: number;
  suspiciousLaneCount: number;
  hasAnalysis: boolean;
}
