import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor-konfiguraatio. Yksi koodipohja tuottaa sekä Android- että iOS-sovelluksen.
const config: CapacitorConfig = {
  appId: 'fi.pikajuoksu.startwatch',
  appName: 'Pikajuoksu',
  webDir: 'dist',
  // Taustalla toimivat ääni- ja kamera-API:t vaativat pysyvät oikeudet.
  plugins: {
    Camera: {
      // Käytetään custom-kameravirtaa (MediaRecorder) natiivin gallerian sijaan.
    },
  },
  android: {
    // Sallitaan mikrofonin ja kameran samanaikainen käyttö.
    allowMixedContent: true,
  },
  ios: {
    // iOS vaatii, että WebView saa käyttää mediaa ilman käyttäjän elettä.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
