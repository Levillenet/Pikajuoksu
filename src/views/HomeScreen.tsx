import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';

/**
 * Etusivu. Kaksi päätoimintoa: VALMIS ja VIDEOT.
 *
 * Opetus on pakollinen: jos pilliä ja pistoolia ei ole vielä opetettu, VALMIS
 * ohjaa ensin opetusnäyttöön. Kun äänet on opetettu, VALMIS aloittaa valvonnan
 * suoraan ja opetuksen voi tarvittaessa uusia erillisestä linkistä.
 */
export function HomeScreen({ app, container }: { app: AppViewModel; container: ServiceContainer }) {
  const calibrated = container.profiles.isComplete();

  return (
    <div className="screen home">
      <header className="home__brand">
        <h1>Pikajuoksu</h1>
        <p>Lähtöjen videovalvonta</p>
      </header>

      <div className="home__actions">
        {calibrated ? (
          <button className="btn btn--primary btn--huge" onClick={() => app.goRecording()}>
            VALMIS
          </button>
        ) : (
          <button className="btn btn--primary btn--huge" onClick={() => app.goCalibration()}>
            OPETA ÄÄNET
          </button>
        )}
        <button className="btn btn--secondary btn--huge" onClick={() => app.goLibrary()}>
          VIDEOT
        </button>
      </div>

      <footer className="home__hint">
        {calibrated ? (
          <>
            Paina <strong>VALMIS</strong> ennen kilpailua – sovellus tunnistaa pillin ja tallentaa
            lähdön automaattisesti.
            <br />
            <button className="link-btn" onClick={() => app.goCalibration()}>
              Opeta äänet uudelleen
            </button>
          </>
        ) : (
          <>
            Ennen ensimmäistä käyttöä opeta sovellukselle <strong>pillin</strong> ja{' '}
            <strong>starttipistoolin</strong> äänet. Paina <strong>OPETA ÄÄNET</strong>.
          </>
        )}
      </footer>
    </div>
  );
}
