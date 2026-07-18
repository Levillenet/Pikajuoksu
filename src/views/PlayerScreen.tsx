import { useEffect, useMemo, useRef } from 'react';
import type { AppViewModel } from '@/viewmodels/AppViewModel';
import type { ServiceContainer } from '@/services/container';
import { PlayerViewModel } from '@/viewmodels/PlayerViewModel';
import { useViewModel } from '@/viewmodels/useViewModel';
import { formatDuration, formatSignedMs } from '@/utils/time';
import { LaneResults } from './components/LaneResults';

/** Hidastusnopeudet, joita tuomari voi käyttää tarkkaan tarkasteluun. */
const RATES = [1, 0.5, 0.25, 0.1];

/**
 * Katselunäkymä. Tuomari voi zoomata, hidastaa, kelata frame kerrallaan,
 * hypätä laukaushetkeen ja käynnistää tekoälyanalyysin, joka merkitsee
 * epäilyttävät radat.
 */
export function PlayerScreen({
  app,
  container,
  recordingId,
}: {
  app: AppViewModel;
  container: ServiceContainer;
  recordingId: string;
}) {
  const vm = useMemo(() => new PlayerViewModel(container), [container]);
  const state = useViewModel(vm);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void vm.load(recordingId);
    return () => vm.dispose();
  }, [vm, recordingId]);

  useEffect(() => {
    if (videoRef.current) vm.attachVideo(videoRef.current);
  }, [vm, state.videoUrl]);

  const gunshotPercent =
    state.gunshotOffsetMs !== null && state.durationMs > 0
      ? (state.gunshotOffsetMs / state.durationMs) * 100
      : null;
  const playheadPercent = state.durationMs > 0 ? (state.currentTimeMs / state.durationMs) * 100 : 0;

  return (
    <div className="screen player">
      <header className="topbar">
        <button className="btn btn--ghost" onClick={() => app.goLibrary()}>
          ← Videot
        </button>
        <h2>{state.recording?.competition ?? 'Video'}</h2>
        <span className="topbar__spacer" />
      </header>

      {state.loading && <p className="muted center">Ladataan videota…</p>}
      {state.error && <p className="error center">{state.error}</p>}

      {state.videoUrl && (
        <>
          <div className="player__stage">
            <video
              ref={videoRef}
              className="player__video"
              src={state.videoUrl}
              playsInline
              // Zoom toteutetaan CSS-skaalauksella (keskitetty).
              style={{ transform: `scale(${state.zoom})` }}
              onClick={() => vm.togglePlay()}
            />
          </div>

          {/* Aikajana, jossa laukaushetki ja soittopää */}
          <div className="timeline">
            <div className="timeline__track">
              <div className="timeline__played" style={{ width: `${playheadPercent}%` }} />
              {gunshotPercent !== null && (
                <div
                  className="timeline__gunshot"
                  style={{ left: `${gunshotPercent}%` }}
                  title="Laukaus (analyysin nollakohta)"
                />
              )}
              <input
                className="timeline__scrub"
                type="range"
                min={0}
                max={Math.max(1, state.durationMs)}
                value={state.currentTimeMs}
                onChange={(e) => vm.seekTo(Number(e.target.value))}
              />
            </div>
            <div className="timeline__labels">
              <span>{formatDuration(state.currentTimeMs)}</span>
              <span>{formatDuration(state.durationMs)}</span>
            </div>
          </div>

          {/* Toiston ohjaus */}
          <div className="controls">
            <button className="icon-btn" title="Kehys taakse" onClick={() => vm.stepFrame(-1)}>
              ⏮
            </button>
            <button className="btn btn--primary" onClick={() => vm.togglePlay()}>
              {state.playing ? 'Tauko' : 'Toista'}
            </button>
            <button className="icon-btn" title="Kehys eteen" onClick={() => vm.stepFrame(1)}>
              ⏭
            </button>
          </div>

          <div className="controls controls--wrap">
            <div className="control-group" role="group" aria-label="Nopeus">
              {RATES.map((r) => (
                <button
                  key={r}
                  className={`chip ${state.playbackRate === r ? 'chip--active' : ''}`}
                  onClick={() => vm.setPlaybackRate(r)}
                >
                  {r === 1 ? '1×' : `${r}×`}
                </button>
              ))}
            </div>

            <div className="control-group" role="group" aria-label="Zoom">
              <button className="chip" onClick={() => vm.setZoom(state.zoom - 0.5)}>
                −
              </button>
              <span className="chip chip--static">{state.zoom.toFixed(1)}×</span>
              <button className="chip" onClick={() => vm.setZoom(state.zoom + 0.5)}>
                +
              </button>
            </div>

            {state.gunshotOffsetMs !== null && (
              <button className="chip chip--shot" onClick={() => vm.jumpToGunshot()}>
                → Laukaukseen
              </button>
            )}
          </div>

          {/* Analyysi */}
          <div className="analysis">
            <div className="analysis__header">
              <h3>Varaslähtöanalyysi</h3>
              <button
                className="btn btn--secondary"
                disabled={state.analyzing || state.gunshotOffsetMs === null}
                onClick={() => void vm.runAnalysis()}
              >
                {state.analyzing ? 'Analysoidaan…' : state.analysis ? 'Analysoi uudelleen' : 'Analysoi'}
              </button>
            </div>

            {state.gunshotOffsetMs === null && (
              <p className="muted">
                Laukausta ei tunnistettu automaattisesti. Voit silti katsoa videon manuaalisesti.
              </p>
            )}

            {state.analysis && (
              <>
                <p className="muted small">
                  Ikkuna {formatSignedMs(-state.analysis.windowBeforeMs)} …{' '}
                  {formatSignedMs(state.analysis.windowAfterMs)} laukauksesta · moottori:{' '}
                  {state.analysis.engine}
                </p>
                {state.analysis.note && <p className="warn small">{state.analysis.note}</p>}
                <LaneResults
                  lanes={state.analysis.lanes}
                  onSelectLane={(offsetFromShotMs) => {
                    if (state.gunshotOffsetMs !== null)
                      vm.seekTo(state.gunshotOffsetMs + offsetFromShotMs);
                  }}
                />
                <p className="disclaimer">Tämä on avustava analyysi, ei virallinen tuomio.</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
