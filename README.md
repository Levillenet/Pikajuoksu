# Pikajuoksu – Lähtöjen videovalvonta ja varaslähtöanalyysi

Mobiilisovellus (Android + iOS) yleisurheilun lähettäjälle ja tuomarille.
Sovellus kuuntelee mikrofonia, käynnistää **pillin havaittuaan** automaattisesti
takakameran videon, merkitsee **starttipistoolin laukauksen** analyysin
nollakohdaksi ja tarjoaa tekoälyavusteisen **varaslähtöanalyysin** ratakohtaisesti.

> Sama koodipohja (React + TypeScript + Capacitor) tuottaa sekä Android- että
> iPhone-sovelluksen.

---

## Toimintaperiaate

1. Lähettäjä painaa **VALMIS** ennen kilpailua eikä koske puhelimeen enää.
2. Sovellus kuuntelee mikrofonia ja jää tilaan **"Odottaa pilliä"**.
3. **Pilli havaitaan** → takakamera käynnistyy ja videon tallennus alkaa
   automaattisesti (vähintään 2 min, kova katto 5 min).
4. **Starttipistoolin laukaus havaitaan** → tarkka ajanhetki merkitään videolle
   analyysin nollakohdaksi (laukaus ei käynnistä tallennusta).
5. Tallennuksen päätyttyä video tallentuu laitteen muistiin automaattisesti.
6. Tuomari avaa videon: zoomaa, hidastaa, kelaa frame kerrallaan ja käynnistää
   **varaslähtöanalyysin**, joka merkitsee epäilyttävät radat.

Analyysi on **avustava, ei virallinen tuomio.**

---

## Arkkitehtuuri (MVVM)

Koodi noudattaa MVVM-mallia ja on jaettu selkeisiin, testattaviin kerroksiin.

```
src/
├── models/            # Model – puhtaat domain-tyypit (ei laite-/UI-riippuvuuksia)
│   └── types.ts
├── services/          # Laite- ja infrastruktuuripalvelut
│   ├── audio/         #   Mikrofonin kuuntelu + pillin & laukauksen tunnistus
│   │   ├── AudioDetectionService.ts
│   │   ├── WhistleDetector.ts      (tonaalinen huippu 1.8–4.5 kHz)
│   │   └── GunshotDetector.ts      (laajakaistainen transientti / onset)
│   ├── camera/        #   Videon tallennus (MediaRecorder, takakamera)
│   │   └── CameraRecordingService.ts
│   ├── analysis/      #   Tekoälyanalyysi
│   │   ├── PoseEngine.ts            (rajapinta: MediaPipe / ML Kit / OpenCV)
│   │   ├── MediaPipePoseEngine.ts   (MediaPipe Pose -toteutus)
│   │   └── FalseStartAnalyzer.ts    (ajallinen liikeanalyysi radoittain)
│   ├── storage/       #   Videoiden ja metadatan tallennus (Filesystem)
│   │   ├── StorageService.ts
│   │   └── RecordingRepository.ts
│   ├── sync/          #   Usean kameran synkronointi laukauksen perusteella
│   │   └── MultiCameraSyncService.ts
│   └── container.ts   #   Kevyt riippuvuusinjektio (palveluiden jako)
├── viewmodels/        # ViewModel – tilakoneet & liiketoimintalogiikka
│   ├── AppViewModel.ts         (navigointi)
│   ├── RecordingViewModel.ts   (koko automaattinen tallennusketju)
│   ├── LibraryViewModel.ts     (kirjasto: lataus/poisto/jako)
│   ├── PlayerViewModel.ts      (toisto + analyysin ajo)
│   └── useViewModel.ts         (React-silta useSyncExternalStorella)
├── views/             # View – ohuet React-komponentit
│   ├── HomeScreen.tsx          (kaksi painiketta: VALMIS / VIDEOT)
│   ├── RecordingScreen.tsx
│   ├── LibraryScreen.tsx
│   ├── PlayerScreen.tsx
│   └── components/LaneResults.tsx
├── utils/             # Observable-tila, EventBus, lokitus, aikafunktiot
└── config.ts          # Kaikki säädettävät parametrit yhdessä paikassa
```

**Miksi MVVM?** Näkymät (View) ovat ohuita ja tilattomia; kaikki logiikka on
ViewModeleissa, jotka perivät `Observable`-luokan ja ovat testattavissa ilman
DOM:ia. Palvelut kapseloivat laite-API:t. Näin esim. pose-moottorin tai
tallennusvaraston voi vaihtaa muuttamatta muuta koodia.

---

## Tekoälyanalyysi

`FalseStartAnalyzer` näytteistää videon aikaikkunassa **−0,5 s … +1,0 s**
laukauksesta, tunnistaa kilpailijoiden asennot (`PoseEngine`, oletuksena
MediaPipe Pose, 33 avainpistettä), ryhmittelee havainnot radoiksi vaakasijainnin
mukaan ja laskee jokaiselle radalle **ensimmäisen liikkeen** suhteessa
laukaukseen. Seurattavat kehonosat: pää, kädet, vartalo, lantio, jalat.

Rata merkitään **epäilyttäväksi**, jos liike alkaa **ennen laukausta** tai
**epäinhimillisen nopeasti** (< 100 ms). Tulos esim.:

```
Rata 2   Mahdollinen varaslähtö   Ensimmäinen liike  −35 ms
Rata 5   Ei huomautettavaa        Reaktioaika       +164 ms
```

Pose-moottori on rajapinnan takana (`PoseEngine`), joten MediaPipen tilalle voi
vaihtaa ML Kitin tai OpenCV:n ilman muutoksia analyysilogiikkaan.

---

## Usean kameran tuki (arkkitehtuuri valmiina)

`MultiCameraSyncService` on mukana jo v1:ssä. Jokaisen kameran ääniraidalta
tunnistetaan **sama laukaus**, jonka offset antaa kameroiden välisen aikaeron.
Kun kaikki videot kohdistetaan laukaushetkeen (t=0), ne ovat samalla aikajanalla
ja tekoäly voi analysoida lähtöä useasta kuvakulmasta. Domain-malli
(`StartRecording.sources: CameraSource[]`) tukee jo useaa lähdettä; v1:ssä
lähteitä on tyypillisesti yksi, mutta laajennus ei vaadi uudelleenkirjoitusta.

---

## Kehitys

```bash
npm install
npm run dev        # kehityspalvelin selaimessa (kamera/mikki vaativat HTTPS/localhost)
npm run build      # tyyppitarkistus + tuotantokäännös
npm run typecheck
```

### Natiivit sovellukset (Capacitor)

```bash
npm run build
npx cap add android      # luo android/-projektin
npx cap add ios          # luo ios/-projektin (vaatii macOS + Xcode)
npm run cap:sync
npx cap open android     # avaa Android Studiossa
npx cap open ios         # avaa Xcodessa
```

### Vaadittavat käyttöoikeudet

Lisää natiiviin projektiin kamera- ja mikrofonioikeudet:

**Android** – `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-feature android:name="android.hardware.camera" android:required="true" />
```

**iOS** – `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Sovellus tallentaa lähtövideon varaslähtöjen tarkastamiseksi.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Sovellus kuuntelee pilliä ja starttipistoolin laukausta.</string>
```

### Offline-mallit (suositus tuotantoon)

MediaPipe Pose -malli ladataan oletuksena CDN:stä
(`MediaPipePoseEngine`). Offline-käyttöä varten niputa `.task`-malli ja
`wasm`-tiedostot sovelluksen mukaan (esim. `public/models/`) ja ohita URL:t
`createPoseEngine`-tehtaassa (`services/container.ts`).

---

## Kalibrointi

Kaikki tunnistuksen ja analyysin parametrit ovat tiedostossa
[`src/config.ts`](src/config.ts): pillin taajuusalue ja kesto, laukauksen
onset-kynnys, analyysi-ikkuna, liikekynnys ja reaktioaikaraja. Säädä näitä
kentän olosuhteiden (tuuli, yleisö, eri pillit ja pistoolit) mukaan.

---

## Virheenkäsittely

Kamera-, mikrofoni- ja tallennusvirheet käsitellään ja näytetään käyttäjälle
(`RecordingViewModel` → `RecordingScreen`). Kamerarajoitteet heikkenevät
sulavasti (varasuunnitelma `getUserMedia`-kutsulle). Tallennuksesta pyydetään
dataa 1 s välein, joten osa videosta säilyy vaikka sovellus keskeytyisi.
Akkua säästetään lataamalla raskas pose-malli vasta analyysia varten.
