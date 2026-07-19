/**
 * Varmistaa, että Androidin sovellusnimi (kuvakkeen alla näkyvä teksti) on
 * oikein. Capacitor asettaa nimen `cap add` -vaiheessa capacitor.config.ts:n
 * appName-arvosta, mutta tämä skripti pakottaa arvon varmuuden vuoksi CI:ssä.
 *
 * Idempotentti: ajaminen uudelleen ei muuta lopputulosta.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APP_NAME = 'False Start Detector';
const path = 'android/app/src/main/res/values/strings.xml';

let xml = readFileSync(path, 'utf8');

// Korvaa app_name ja title_activity_main -merkkijonojen arvot.
for (const key of ['app_name', 'title_activity_main']) {
  const re = new RegExp(`(<string name="${key}">)(.*?)(</string>)`);
  if (re.test(xml)) {
    xml = xml.replace(re, `$1${APP_NAME}$3`);
  }
}

writeFileSync(path, xml);
console.log(`strings.xml: sovellusnimi asetettu -> "${APP_NAME}"`);
