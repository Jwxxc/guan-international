import type { GameState, Seat } from '../engine/types';
import { teamOf } from '../engine/rules';
import { seatName, type SeatNames } from './tableView';

export type VictoryState = Pick<GameState, 'sessionId' | 'handId' | 'events' | 'result' | 'finished'>;
export interface VictoryOptions { viewerSeat?: Seat; seatNames?: SeatNames; presentationEpoch?: string | number }

export interface VictoryMoment {
  key: string; kind: 'first' | 'hand' | 'match'; seat: Seat; team: 0 | 1;
  title: string; subtitle: string; duration: number; particles: number; reduced?: boolean; ours?: boolean;
}

/** Derives only public achievements from the last committed action. No state mutation. */
export function getVictoryMoment(state: VictoryState, matchWinner?: 0 | 1 | null, options: VictoryOptions = {}): VictoryMoment | null {
  const viewerTeam = teamOf(options.viewerSeat ?? 0);
  const event=state.events.at(-1);
  if(!event||event.type!=='play'||event.finished===undefined)return null;
  let kind:VictoryMoment['kind'];let title:string;let subtitle:string;let team:0|1;let seat=event.finished;
  if(state.result){
    team=state.result.winningTeam;
    seat=state.result.order[0];
    kind=matchWinner===team?'match':'hand';
    title=kind==='match'?'整场获胜':state.result.doubleUp?'双上 · 本副获胜':'本副获胜';
    subtitle=([0, 1, 2, 3] as const).filter(player => teamOf(player) === team).map(player => seatName(player, options.seatNames)).join('与');
  }else if(state.finished[0]===event.finished){
    kind='first';team=teamOf(event.finished);title=`${seatName(event.finished, options.seatNames)} · 头游`;
    subtitle=team===viewerTeam?'我方率先出完':'对方率先出完';
  }else return null;
  return {key:`${state.sessionId}:${state.handId}:${event.index}:${kind}`,kind,seat,team,title,subtitle,ours:team===viewerTeam,
    duration:kind==='first'?1900:kind==='hand'?2400:3000,
    particles:team!==viewerTeam?12:kind==='first'?24:kind==='hand'?42:60};
}
