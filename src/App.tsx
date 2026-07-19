import { useEffect, useMemo } from 'react';
import { container } from './services/container';
import { AppViewModel } from './viewmodels/AppViewModel';
import { useViewModel } from './viewmodels/useViewModel';
import { HomeScreen } from './views/HomeScreen';
import { CalibrationScreen } from './views/CalibrationScreen';
import { SettingsScreen } from './views/SettingsScreen';
import { RecordingScreen } from './views/RecordingScreen';
import { LibraryScreen } from './views/LibraryScreen';
import { PlayerScreen } from './views/PlayerScreen';

/**
 * App on juurikomponentti, joka hoitaa näkymien välisen navigoinnin
 * AppViewModelin tilan perusteella. Jaettu ServiceContainer välitetään
 * näkymille, jotka luovat omat näkymämallinsa.
 */
export function App() {
  // AppViewModel elää koko sovelluksen eliniän.
  const app = useMemo(() => new AppViewModel(), []);
  const { screen } = useViewModel(app);

  // Käynnistä lähiyhteys (Nearby) valitulla roolilla ja avaa vastaanotetut
  // videot automaattisesti. Turvallinen myös web-alustalla (ei tee mitään).
  useEffect(() => {
    void container.nearby.init((recordingId) => app.goPlayer(recordingId));
  }, [app]);

  switch (screen.name) {
    case 'home':
      return <HomeScreen app={app} container={container} />;
    case 'calibration':
      return <CalibrationScreen app={app} container={container} />;
    case 'settings':
      return <SettingsScreen app={app} container={container} />;
    case 'recording':
      return <RecordingScreen app={app} container={container} />;
    case 'library':
      return <LibraryScreen app={app} container={container} />;
    case 'player':
      return <PlayerScreen app={app} container={container} recordingId={screen.recordingId} />;
    default:
      return <HomeScreen app={app} container={container} />;
  }
}
