import { tx } from '../i18n';
import type { GameState, Seat } from '../engine/types';
import { partnerOf } from '../engine/rules';
import { relativeSeat, seatPosition, toTableView, type TableView } from '../game/tableView';
const namedAvatars = new Map<string, string>([['青禾', '禾'], ['南山', '山'], ['松风', '松']]);
export function PlayerSeat({ seat, state: localState, view }: { seat: Seat; state?: GameState; view?: TableView }) {
  const state = view ?? (localState ? toTableView(localState) : null);
  if (!state) throw Error('座位缺少公开视图');
  const info = state.seats[seat]; const active = !state.result && state.currentPlayer === seat;
  const partner = seat === partnerOf(state.viewerSeat), relative = relativeSeat(seat, state.viewerSeat);
  const finished = state.finished.indexOf(seat), count = state.remainingCounts[seat];
  const status = info.controlMode === 'takeover' ? 'AI 托管' : info.connected === false || info.controlMode === 'offline' ? '暂时离线' : null;
  const role = partner ? '对家' : relative === 1 ? '对手 · 下家' : '对手 · 上家';
  const avatar = namedAvatars.get(info.name) ?? Array.from(info.name)[0] ?? '';
  return <div className={`player-seat seat-${seatPosition(seat, state.viewerSeat)} ${active ? 'seat-active' : ''} ${partner ? 'teammate' : ''}`}
    data-seat={seat} data-current-turn={active} data-has-current-play={state.currentOwner === seat && !!state.currentPlay}
    aria-label={tx(`${info.name}，${role}，剩余 ${count} 张${status ? `，${status}` : ''}`)}>
    <div className="seat-avatar" aria-hidden="true"><span>{tx(avatar)}</span>{tx(active && <span className="thinking-dot" />)}</div>
    <div className="seat-info"><div className="seat-name">{tx(info.name)}<span className={`partner-badge ${partner ? '' : 'opponent-badge'}`}>{tx(partner ? '对家' : '对手')}</span></div>{tx((active || !partner || status) && <div className="seat-role">{tx(status ?? (active ? <span className="seat-action-label">{tx("当前行动")}</span> : relative === 1 ? '下家' : '上家'))}</div>)}</div>
    <div className="seat-count">{tx(finished >= 0 ? <span className="finished-label">{tx(['头游','二游','三游'][finished] ?? '已出完')}</span> : <><b>{tx(count)}</b><span> {tx("张")}</span></>)}</div>
  </div>;
}
