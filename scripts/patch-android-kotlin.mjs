/**
 * Lisää Kotlin Gradle -pluginin classpathin generoituun Android-projektiin,
 * jotta Kotlin-pohjainen Nearby-plugin kääntyy. Capacitorin oletusprojekti ei
 * sisällä Kotlin-tukea, joten se lisätään tässä CI:ssä `cap add` -vaiheen
 * jälkeen. Idempotentti.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const KOTLIN_VERSION = '1.9.25';
const path = 'android/build.gradle';

let gradle = readFileSync(path, 'utf8');

if (gradle.includes('kotlin-gradle-plugin')) {
  console.log('android/build.gradle: Kotlin-classpath oli jo paikallaan.');
} else {
  // Lisää classpath heti Android Gradle -pluginin classpathin jälkeen.
  const agpLine = /(classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"])/;
  if (agpLine.test(gradle)) {
    gradle = gradle.replace(
      agpLine,
      `$1\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"`
    );
    writeFileSync(path, gradle);
    console.log(`android/build.gradle: lisättiin Kotlin-classpath ${KOTLIN_VERSION}.`);
  } else {
    console.error('android/build.gradle: AGP-classpath-riviä ei löytynyt – Kotlin-tukea ei lisätty.');
    process.exit(1);
  }
}
