import { useState } from 'react';
import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';
import type { DeviceRole } from '@/models/nearby';
import { useViewModel } from '@/viewmodels/useViewModel';

/**
 * Asetukset. Tällä hetkellä: laitteen rooli lähiyhteydessä (Camera/Viewer).
 * Rooli tallennetaan pysyvästi ja yhteys käynnistetään heti uudelleen.
 */
export function SettingsScreen({
  app,
  container,
}: {
  app: AppViewModel;
  container: ServiceContainer;
}) {
  const conn = useViewModel(container.connection);
  const [role, setRole] = useState<DeviceRole | null>(() => container.settings.getRole());

  const choose = (r: DeviceRole) => {
    setRole(r);
    void container.nearby.setRole(r);
  };

  return (
    <div className="screen settings">
      <header className="topbar">
        <button className="btn btn--ghost" onClick={() => app.goHome()}>
          ← Etusivu
        </button>
        <h2>Asetukset</h2>
        <span className="topbar__spacer" />
      </header>

      <h3 className="settings__section">Laitteen rooli</h3>
      <p className="muted small">
        Sama sovellus toimii kahdessa roolissa. Yhteys muodostuu automaattisesti lähellä olevaan
        toiseen laitteeseen – ei asetuksia, ei internetiä.
      </p>

      <div className="role-grid">
        <button
          className={`role-card ${role === 'camera' ? 'role-card--active' : ''}`}
          onClick={() => choose('camera')}
        >
          <div className="role-card__icon">🎥</div>
          <div className="role-card__title">Camera</div>
          <div className="role-card__desc">Kuvaava puhelin. Tallentaa lähdöt ja lähettää videot Viewerille.</div>
        </button>

        <button
          className={`role-card ${role === 'viewer' ? 'role-card--active' : ''}`}
          onClick={() => choose('viewer')}
        >
          <div className="role-card__icon">👁️</div>
          <div className="role-card__title">Viewer</div>
          <div className="role-card__desc">Lähettäjän/erotuomarin puhelin. Vastaanottaa ja katsoo videot.</div>
        </button>
      </div>

      {role && (
        <div className="settings__status">
          <div className="conn-badge conn-badge--big">
            <span aria-hidden>
              {conn.status === 'connected' ? '🟢' : conn.status === 'searching' ? '🟡' : '🔴'}
            </span>
            <span>
              {conn.status === 'connected'
                ? 'Yhdistetty'
                : conn.status === 'searching'
                  ? role === 'camera'
                    ? 'Odottaa Vieweria…'
                    : 'Etsitään kameraa…'
                  : 'Ei yhteyttä'}
            </span>
          </div>
          {!conn.available && (
            <p className="muted small">
              Lähiyhteys toimii vain asennetussa Android-sovelluksessa (ei selaimessa).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
