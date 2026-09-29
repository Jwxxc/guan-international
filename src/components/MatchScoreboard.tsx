import { tx } from '../i18n';
import { rankName, teamOf } from '../engine/rules';
import type { Seat } from '../engine/types';
import type { MatchProgress } from '../match/types';

/** Team progress is independent; Table's level indicator remains the shared rank. */
export function MatchScoreboard({ progress, viewerSeat = 0 }: { progress: MatchProgress; viewerSeat?: Seat }) {
  const ours = teamOf(viewerSeat), theirs = (1 - ours) as 0 | 1;
  return <div className="match-scoreboard" aria-label={tx(`第 ${progress.handNumber} 副，我方级数 ${rankName(progress.teamLevels[ours])}，对方级数 ${rankName(progress.teamLevels[theirs])}`)} data-testid="match-scoreboard">
    <span className="match-hand-number">{tx(`第 ${progress.handNumber} 副`)}</span>
    <span className="team-score team-score-ours"><span>{tx("我方")}</span><strong>{tx(rankName(progress.teamLevels[ours]))}</strong></span>
    <span className="team-score"><span>{tx("对方")}</span><strong>{tx(rankName(progress.teamLevels[theirs]))}</strong></span>
  </div>;
}
