import type { ServiceContainer } from '@/services/container';
import { useViewModel } from '@/viewmodels/useViewModel';

/**
 * Pieni yhteyden tilakuvake (🔴/🟡/🟢). Näytetään molemmissa rooleissa.
 * Näyttää myös käynnissä olevan videosiirron etenemisprosentin.
 *
 * Näytetään vain, kun rooli on valittu ja lähiyhteys on käytettävissä
 * (natiivi) – muuten piilotetaan, jottei web-/kehityskäyttö häiriinny.
 */
export function ConnectionBadge({ container }: { container: ServiceContainer }) {
  const state = useViewModel(container.connection);

  if (!state.role) return null;

  const dot = state.status === 'connected' ? '🟢' : state.status === 'searching' ? '🟡' : '🔴';
  const label =
    state.status === 'connected'
      ? state.role === 'camera'
        ? 'Viewer yhdistetty'
        : 'Yhdistetty kameraan'
      : state.status === 'searching'
        ? state.role === 'camera'
          ? 'Odottaa Vieweria'
          : 'Etsitään kameraa'
        : 'Ei yhteyttä';

  const pct = state.transferFraction !== null ? Math.round(state.transferFraction * 100) : null;

  return (
    <div className="conn-badge" title={label}>
      <span className="conn-badge__dot" aria-hidden>
        {dot}
      </span>
      <span className="conn-badge__label">{label}</span>
      {pct !== null && (
        <span className="conn-badge__pct">
          {state.transferDirection === 'incoming' ? '↓' : '↑'} {pct}%
        </span>
      )}
    </div>
  );
}
