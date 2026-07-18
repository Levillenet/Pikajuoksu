/**
 * Lisää tarvittavat kamera- ja mikrofonioikeudet Capacitorin generoimaan
 * AndroidManifest.xml-tiedostoon. Ajetaan CI:ssä `npx cap add android`
 * -komennon jälkeen, koska android/-kansio ei ole versionhallinnassa.
 *
 * Skripti on idempotentti: jo olemassa olevia oikeuksia ei lisätä uudelleen.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';

const permissions = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  // MODIFY_AUDIO_SETTINGS on pakollinen: Capacitorin WebView vaatii sen
  // getUserMedia-äänikaappaukselle. Ilman tätä koko kamera+mikki-pyyntö
  // hylätään "Permission denied" -virheellä, vaikka kamera ja mikrofoni
  // näkyisivät jo sallittuina laitteen asetuksissa.
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  // Kamera ei ole pakollinen laitevaatimus (required=false) → asennus onnistuu
  // myös laajemmalla laitejoukolla.
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];

let xml = readFileSync(manifestPath, 'utf8');

// Kerää vain ne rivit, joita ei vielä ole.
const missing = permissions.filter((p) => {
  const marker = p.match(/android:name="([^"]+)"/)?.[1];
  return marker ? !xml.includes(marker) : true;
});

if (missing.length === 0) {
  console.log('AndroidManifest: oikeudet olivat jo paikallaan.');
} else {
  // Lisää oikeudet juuri ennen <application>-elementtiä.
  const block = missing.map((p) => `    ${p}`).join('\n') + '\n';
  xml = xml.replace(/(\s*)<application/, `\n${block}$1<application`);
  writeFileSync(manifestPath, xml);
  console.log(`AndroidManifest: lisättiin ${missing.length} oikeutta.`);
}
