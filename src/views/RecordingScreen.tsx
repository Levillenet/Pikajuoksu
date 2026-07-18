import { useEffect, useMemo, useRef } from 'react';
import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';
import { RecordingViewModel } from '@/viewmodels/RecordingViewModel';
import { useViewModel } from '@/viewmodels/useViewModel';
import { formatDuration } from '@/utils/time';

/**
 * Tallennusnäkymä. Käynnistää valvonnan automaattisesti (VALMIS), näyttää
 * tilan ("Odottaa pilliä" / "Tallennus käynnissä"), esikatselukuvan,
 * mikrofonin tasomittarin ja jäljellä olevan ajan. Käyttäjän ei tarvitse
 * koskea puhelimeen pillin jälkeen.
 */
export function RecordingScreen({
  app,
  container,
}: {
  app: AppViewModel;
  container: ServiceContainer;
}) {
  const vm = useMemo(() => new RecordingViewModel(container), [container]);
  const state = useViewModel(vm);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Käynnistä valvonta heti näkymään tultaessa; siivoa poistuttaessa.
  useEffect(() => {
    const defaultName = 'Lähtö ' + new Date().toLocaleDateString('fi-FI');
    void vm.arm(defaultName);
    return () => {
      void vm.cancel();
    };
  }, [vm]);

  // Kytke esikatselustriimi video-elementtiin, kun se on valmis.
  useEffect(() => {
    if (state.previewReady && videoRef.current) {
      videoRef.current.srcObject = vm.getPreviewStream();
    }
  }, [state.previewReady, vm]);

  // Kun tallenne valmistuu, siirry katsomaan sitä.
  useEffect(() => {
    if (state.lastRecordingId) app.goPlayer(state.lastRecordingId);
  }, [state.lastRecordingId, app]);

  const statusText = {
    idle: 'Valmistellaan…',
    arming: 'Käynnistetään kameraa…',
    waiting: 'Odottaa pilliä',
    recording: 'Tallennus käynnissä',
    saving: 'Tallennetaan videota…',
    error: 'Virhe',
  }[state.phase];

  return (
    <div className="screen recording">
      {/* Esikatselu peittää taustan */}
      <video ref={videoRef} className="recording__preview" autoPlay muted playsInline />

      <div className="recording__overlay">
        <button className="btn btn--ghost recording__back" onClick={() => void vm.cancel().then(() => app.goHome())}>
          ← Takaisin
        </button>

        <div className={`recording__status recording__status--${state.phase}`}>
          {state.phase === 'recording' && <span className="rec-dot" aria-hidden />}
          <span>{statusText}</span>
        </div>

        {state.phase === 'waiting' && (
          <div className="recording__center">
            <div className="pulse-ring" aria-hidden />
            <p className="recording__hint">Voit laittaa puhelimen paikoilleen. Kuunnellaan pilliä…</p>
            <input
              className="recording__name"
              placeholder="Kilpailun nimi (valinnainen)"
              defaultValue=""
              onChange={(e) => vm.setCompetition(e.target.value)}
            />
          </div>
        )}

        {state.phase === 'recording' && (
          <div className="recording__center">
            <div className="recording__time">{formatDuration(state.remainingMs)}</div>
            <p className="recording__hint">Jäljellä vähintään</p>
            {state.gunshotOffsetMs !== null ? (
              <div className="badge badge--shot">Laukaus merkitty ✓</div>
            ) : (
              <div className="badge">Kuunnellaan laukausta…</div>
            )}
            <button className="btn btn--secondary" onClick={() => void vm.stopEarly()}>
              Lopeta nyt
            </button>
          </div>
        )}

        {/* Mikrofonin tasomittari: näkyvä palaute siitä, että kuuntelu toimii. */}
        {(state.phase === 'waiting' || state.phase === 'recording') && (
          <div className="mic-meter" title="Mikrofonin taso">
            <div className="mic-meter__bar" style={{ width: `${Math.min(100, state.micLevel * 140)}%` }} />
          </div>
        )}

        {state.phase === 'error' && (
          <div className="recording__error">
            <p>{state.error}</p>
            <div className="row">
              <button className="btn btn--primary" onClick={() => void vm.arm('Lähtö')}>
                Yritä uudelleen
              </button>
              <button className="btn btn--ghost" onClick={() => app.goHome()}>
                Etusivulle
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
