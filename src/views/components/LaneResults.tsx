import type { LaneAnalysis } from '@/models/types';
import { formatSignedMs } from '@/utils/time';

/** Kehonosien suomenkieliset nimet diagnostiikkaa varten. */
const GROUP_LABELS: Record<string, string> = {
  head: 'pää',
  arms: 'kädet',
  torso: 'vartalo',
  hips: 'lantio',
  legs: 'jalat',
};

/**
 * Näyttää ratakohtaiset analyysitulokset. Epäilyttävät radat korostetaan.
 * Kortin klikkaus vie videon kyseisen radan ensimmäiseen liikkeeseen.
 */
export function LaneResults({
  lanes,
  onSelectLane,
}: {
  lanes: LaneAnalysis[];
  onSelectLane: (offsetFromShotMs: number) => void;
}) {
  if (lanes.length === 0) {
    return <p className="muted">Ei tunnistettuja ratoja analyysi-ikkunassa.</p>;
  }

  return (
    <ul className="lanes">
      {lanes.map((lane) => (
        <li
          key={lane.lane}
          className={`lane ${lane.suspicious ? 'lane--suspicious' : 'lane--ok'}`}
          onClick={() =>
            lane.firstMovementRelativeToShotMs !== null &&
            onSelectLane(lane.firstMovementRelativeToShotMs)
          }
        >
          <div className="lane__num">Rata {lane.lane}</div>
          <div className="lane__body">
            {lane.suspicious ? (
              <div className="lane__verdict lane__verdict--warn">Mahdollinen varaslähtö</div>
            ) : (
              <div className="lane__verdict lane__verdict--ok">Ei huomautettavaa</div>
            )}

            {lane.firstMovementRelativeToShotMs !== null ? (
              <div className="lane__metric">
                <span className="lane__metric-label">
                  {lane.reactionTimeMs !== null ? 'Reaktioaika' : 'Ensimmäinen liike'}
                </span>
                <span className="lane__metric-value">
                  {formatSignedMs(lane.firstMovementRelativeToShotMs)}
                </span>
              </div>
            ) : (
              <div className="lane__metric lane__metric--muted">Liikettä ei havaittu</div>
            )}

            {lane.triggeringGroups.length > 0 && (
              <div className="lane__groups">
                {lane.triggeringGroups.map((g) => GROUP_LABELS[g] ?? g).join(', ')}
              </div>
            )}
          </div>
          <div className="lane__confidence" title="Analyysin luottamus">
            {Math.round(lane.confidence * 100)}%
          </div>
        </li>
      ))}
    </ul>
  );
}
