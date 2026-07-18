import type { AppViewModel } from '@/viewmodels/AppViewModel';

/**
 * Etusivu. Vaatimuksen mukaan vain kaksi painiketta: VALMIS ja VIDEOT.
 * Yksinkertaisuus on tarkoituksellista – lähettäjän on löydettävä toiminto
 * välittömästi ilman opettelua.
 */
export function HomeScreen({ app }: { app: AppViewModel }) {
  return (
    <div className="screen home">
      <header className="home__brand">
        <h1>Pikajuoksu</h1>
        <p>Lähtöjen videovalvonta</p>
      </header>

      <div className="home__actions">
        <button className="btn btn--primary btn--huge" onClick={() => app.goRecording()}>
          VALMIS
        </button>
        <button className="btn btn--secondary btn--huge" onClick={() => app.goLibrary()}>
          VIDEOT
        </button>
      </div>

      <footer className="home__hint">
        Paina <strong>VALMIS</strong> ennen kilpailua – sovellus tunnistaa pillin ja tallentaa
        lähdön automaattisesti.
      </footer>
    </div>
  );
}
