import { useEffect, useMemo } from 'react';
import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';
import { LibraryViewModel } from '@/viewmodels/LibraryViewModel';
import { useViewModel } from '@/viewmodels/useViewModel';
import { formatClock, formatDate, formatDuration } from '@/utils/time';

/**
 * Videokirjaston listanäkymä. Jokaisesta tallenteesta näytetään päivämäärä,
 * kellonaika, kilpailu ja pituus. Videon voi avata, poistaa tai jakaa.
 */
export function LibraryScreen({
  app,
  container,
}: {
  app: AppViewModel;
  container: ServiceContainer;
}) {
  const vm = useMemo(() => new LibraryViewModel(container), [container]);
  const state = useViewModel(vm);

  useEffect(() => {
    void vm.refresh();
  }, [vm]);

  return (
    <div className="screen library">
      <header className="topbar">
        <button className="btn btn--ghost" onClick={() => app.goHome()}>
          ← Etusivu
        </button>
        <h2>Videot</h2>
        <span className="topbar__spacer" />
      </header>

      {state.loading && <p className="muted center">Ladataan…</p>}
      {state.error && <p className="error center">{state.error}</p>}

      {!state.loading && state.items.length === 0 && (
        <div className="empty">
          <p>Ei vielä tallenteita.</p>
          <button className="btn btn--primary" onClick={() => app.goRecording()}>
            Aloita valvonta
          </button>
        </div>
      )}

      <ul className="rec-list">
        {state.items.map((item) => (
          <li key={item.id} className="rec-card" onClick={() => app.goPlayer(item.id)}>
            <div className="rec-card__main">
              <div className="rec-card__title">{item.competition}</div>
              <div className="rec-card__meta">
                {formatDate(item.createdAtEpochMs)} · {formatClock(item.createdAtEpochMs)} ·{' '}
                {formatDuration(item.durationMs)}
                {item.cameraCount > 1 && ` · ${item.cameraCount} kameraa`}
              </div>
              {item.hasAnalysis &&
                (item.suspiciousLaneCount > 0 ? (
                  <span className="tag tag--warn">{item.suspiciousLaneCount} epäilyttävää rataa</span>
                ) : (
                  <span className="tag tag--ok">Analysoitu · ei huomautettavaa</span>
                ))}
            </div>
            <div className="rec-card__actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn" title="Jaa" onClick={() => void vm.share(item.id)}>
                ⤴
              </button>
              <button
                className="icon-btn icon-btn--danger"
                title="Poista"
                onClick={() => {
                  if (confirm('Poistetaanko tallenne pysyvästi?')) void vm.delete(item.id);
                }}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
