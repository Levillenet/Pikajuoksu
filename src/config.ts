/**
 * Sovelluksen keskitetyt asetukset. Kaikki säädettävät parametrit yhdessä
 * paikassa helpottaa kalibrointia kentällä eri olosuhteissa (tuuli, yleisö,
 * eri pillit ja starttipistoolit).
 */
export const AppConfig = {
  /** Videotallennuksen vähimmäiskesto pillin havaitsemisen jälkeen (ms). */
  minRecordingDurationMs: 2 * 60 * 1000, // 2 minuuttia

  /** Kova yläraja tallennukselle, ettei akku/muisti lopu (ms). */
  maxRecordingDurationMs: 5 * 60 * 1000, // 5 minuuttia

  audio: {
    /** Näytteenottotaajuus, johon AudioContext pyritään asettamaan. */
    targetSampleRate: 48000,
    /** FFT-koko taajuusanalyysille. Suurempi = parempi taajuusresoluutio. */
    fftSize: 2048,
    /**
     * Pillin tunnistus: pillit tuottavat kirkkaan, kapean sävelen
     * tyypillisesti n. 2–4 kHz alueella pitkähkönä (>150 ms) huippuna.
     */
    whistle: {
      minFreqHz: 1800,
      maxFreqHz: 4500,
      /** Vähimmäisenergia (dB yli taustan), jotta huippu lasketaan pilliksi. */
      thresholdDb: 12,
      /** Kuinka kauan sävelen tulee kestää yhtäjaksoisesti (ms). */
      minDurationMs: 150,
      /** Jäähdytysaika, ettei sama pilli laukea moneen kertaan (ms). */
      cooldownMs: 3000,
    },
    /**
     * Laukauksen tunnistus: starttipistooli on erittäin lyhyt, laajakaistainen
     * ja voimakas transientti (impulssi). Tunnistus perustuu äkilliseen
     * kokonaisenergian nousuun (onset) laajalla taajuusalueella.
     */
    gunshot: {
      /** Energian äkillinen nousukynnys (kerroin liukuvaan keskiarvoon nähden). */
      onsetRatio: 6,
      /** Minimikokonaisvoimakkuus (RMS 0..1), ettei kohina laukaise. */
      minRms: 0.12,
      /** Jäähdytysaika (ms), ettei kaiku laukaise uudelleen. */
      cooldownMs: 1500,
    },
  },

  analysis: {
    /** Analyysi-ikkuna ennen laukausta (ms). */
    windowBeforeMs: 500,
    /** Analyysi-ikkuna laukauksen jälkeen (ms). */
    windowAfterMs: 1000,
    /**
     * Liikekynnys: kuinka suuri normalisoitu avainpisteen siirtymä lasketaan
     * "liikkeeksi". Arvo suhteessa kuvan korkeuteen.
     */
    movementThreshold: 0.012,
    /** Reaktioaikaraja (ms): tätä nopeampi reaktio on ihmiselle mahdoton. */
    minHumanReactionMs: 100,
    /** Kuinka monta perättäistä framea liikkeen tulee jatkua (kohinan suodatus). */
    consecutiveFrames: 2,
    /** Analyysin kohdekuvataajuus (fps), johon video näytteistetään. */
    sampleFps: 60,
  },

  storage: {
    /** Kansio laitteen muistissa, johon videot tallennetaan. */
    directory: 'pikajuoksu',
    /** Kirjaston metadatan avain. */
    libraryKey: 'pikajuoksu.library.v1',
  },
} as const;

export type AppConfigType = typeof AppConfig;
