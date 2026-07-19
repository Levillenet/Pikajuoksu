import { useMemo } from 'react';
import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';
import { CalibrationViewModel, type LearnStatus } from '@/viewmodels/CalibrationViewModel';
import { useViewModel } from '@/viewmodels/useViewModel';

/**
 * Kalibrointinäyttö ("Opeta äänet"). Opetus on pakollinen ennen käyttöä:
 * lähettäjä opettaa sekä oman pillinsä että starttipistoolinsa äänen, jotta
 * tunnistus perustuu juuri näihin ääniin (ei yleiseen sääntöön).
 */
export function CalibrationScreen({
  app,
  container,
}: {
  app: AppViewModel;
  container: ServiceContainer;
}) {
  const vm = useMemo(() => new CalibrationViewModel(container), [container]);
  const state = useViewModel(vm);

  const anyRecording = state.whistleStatus === 'recording' || state.gunshotStatus === 'recording';
  const countdownSec = Math.ceil(state.countdownMs / 1000);

  return (
    <div className="screen calibration">
      <header className="topbar">
        <button className="btn btn--ghost" onClick={() => app.goHome()}>
          ← Etusivu
        </button>
        <h2>Opeta äänet</h2>
        <span className="topbar__spacer" />
      </header>

      <p className="muted small calibration__intro">
        Opeta sovellukselle oma pillisi ja starttipistoolisi ääni. Näin sovellus tunnistaa juuri
        oikeat äänet eikä reagoi esimerkiksi puheeseen tai yskimiseen. Opetus on pakollinen ennen
        valvonnan käyttöä.
      </p>

      {/* Pilli */}
      <LearnCard
        title="1. Pilli"
        status={state.whistleStatus}
        recordingHint="Vihellä pilliin nyt…"
        doneText={state.whistleFreqHz !== null ? `Opetettu ✓ (sävel ${state.whistleFreqHz} Hz)` : 'Opetettu ✓'}
        countdownSec={countdownSec}
        level={state.liveLevel}
        freqHz={state.liveFreqHz}
        disabled={anyRecording}
        onLearn={() => void vm.teachWhistle()}
      />

      {/* Pistooli */}
      <LearnCard
        title="2. Starttipistooli"
        status={state.gunshotStatus}
        recordingHint="Laukaise pistooli nyt…"
        doneText="Opetettu ✓"
        countdownSec={countdownSec}
        level={state.liveLevel}
        freqHz={null}
        disabled={anyRecording}
        onLearn={() => void vm.teachGunshot()}
      />

      {state.error && <p className="error center">{state.error}</p>}

      <div className="calibration__actions">
        {state.complete ? (
          <button className="btn btn--primary btn--huge" onClick={() => app.goHome()}>
            Valmis
          </button>
        ) : (
          <p className="muted center small">Opeta molemmat äänet jatkaaksesi.</p>
        )}
        {(state.whistleStatus === 'done' || state.gunshotStatus === 'done') && (
          <button className="btn btn--ghost" disabled={anyRecording} onClick={() => vm.reset()}>
            Opeta alusta
          </button>
        )}
      </div>
    </div>
  );
}

/** Yhden äänen opetuskortti. */
function LearnCard({
  title,
  status,
  recordingHint,
  doneText,
  countdownSec,
  level,
  freqHz,
  disabled,
  onLearn,
}: {
  title: string;
  status: LearnStatus;
  recordingHint: string;
  doneText: string;
  countdownSec: number;
  level: number;
  freqHz: number | null;
  disabled: boolean;
  onLearn: () => void;
}) {
  return (
    <div className={`learn-card learn-card--${status}`}>
      <div className="learn-card__head">
        <h3>{title}</h3>
        {status === 'done' && <span className="tag tag--ok">{doneText}</span>}
      </div>

      {status === 'recording' ? (
        <div className="learn-card__recording">
          <p>{recordingHint}</p>
          <div className="learn-card__count">{countdownSec}</div>
          {/* Reaaliaikainen tasomittari: jos palkki liikkuu ääntä tehdessäsi,
              mikrofoni toimii. Jos ei liiku lainkaan, ongelma on mikrofonissa. */}
          <div className="mic-meter mic-meter--inline" title="Mikrofonin taso">
            <div className="mic-meter__bar" style={{ width: `${Math.min(100, level * 100)}%` }} />
          </div>
          <div className="learn-card__live">
            {level > 0.03 ? (
              <>Kuulee ääntä{freqHz ? ` · ${freqHz} Hz` : ''}</>
            ) : (
              <>Ei ääntä vielä…</>
            )}
          </div>
        </div>
      ) : (
        <button className="btn btn--secondary" disabled={disabled} onClick={onLearn}>
          {status === 'done' ? 'Opeta uudelleen' : 'Opeta'}
        </button>
      )}
    </div>
  );
}
