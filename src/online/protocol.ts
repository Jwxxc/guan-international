import type { AiObservation } from '../ai/types';
import type { StrategyStamp as PolicyStamp,SeatPolicies,AiTier,StrategyDescriptor } from '../ai/strategyTypes';
import type { GameResult, Seat } from '../engine/types';
import type { MatchJournal, MatchSession } from '../match/sessionTypes';
import type { CompletedHand } from '../match/completedHands';
import type { ExchangeObservation, MatchProgress } from '../match/types';

// v2 prevents an older ID-only client from silently using baseline for a balanced room.
export const PROTOCOL_VERSION = 'guan-online-v2' as const;
export const REQUEST_EVENT = 'guan:request' as const;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;
export const MAX_REQUEST_BYTES = 16_384;
export type RoomPhase = 'lobby' | MatchSession['phase'];
export interface PublicSeat {
  seat: Seat; kind: 'empty' | 'human' | 'ai'; playerId: string | null; nickname: string;
  ready: boolean; connected: boolean; control: 'human' | 'ai' | 'reconnecting' | 'takeover';
}
export interface RoomOptions { offlineTakeover: boolean; offlineGraceMs: number; aiTier?:AiTier; endgameFix?:boolean }
export interface RoomSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION; roomCode: string; createdAt: number;
  hostPlayerId: string; phase: RoomPhase; stateVersion: number; serverSeq: number;
  seats: PublicSeat[]; options: RoomOptions; rulesVersion: 'guan-classic-house-v1'; matchId: string | null;
  aiNotice?:string;
}
/** This wire type must never contain MatchSession, other hands, seed, or pending choices. */
export interface OnlineObservation {
  protocolVersion: typeof PROTOCOL_VERSION; roomCode: string; stateVersion: number; serverSeq: number;
  phase: MatchSession['phase']; game: AiObservation; result: GameResult | null; progress: MatchProgress;
  exchange: ExchangeObservation | null; antiTribute: boolean; firstPlayer: Seat; policy: PolicyStamp; seatPolicies?:SeatPolicies; policyDescriptor?:StrategyDescriptor;
  completedHands?: CompletedHand[];
}
/** Private acknowledgement, sent only to the authenticated connection. Never an invite parameter. */
export interface PlayerSession { roomCode: string; playerId: string; seat: Seat; playerToken: string; recoveryCode?: string }
export type OnlineAction = { type: 'play'; cardIds: string[]; playKey: string } | { type: 'pass' }
  | { type: 'tribute' | 'return'; cardId: string } | { type: 'nextHand' | 'beginHand' };
interface Base { protocolVersion: typeof PROTOCOL_VERSION }
interface Mutation extends Base { roomCode: string; clientActionId: string; expectedStateVersion: number }
export type ClientRequest =
  | (Base & { type: 'room:create'; nickname: string; clientActionId: string; offlineTakeover?: boolean; aiTier?:AiTier; endgameFix?:boolean })
  | (Base & { type: 'room:join'; roomCode: string; nickname: string; clientActionId: string })
  | (Base & { type: 'room:resume'; roomCode: string; playerToken: string })
  | (Base & { type: 'room:recover'; roomCode: string; recoveryCode: string })
  | (Mutation & { type: 'room:selectSeat'; seat: Seat })
  | (Mutation & { type: 'room:setReady'; ready: boolean })
  | (Mutation & { type: 'room:setAiSeat'; seat: Seat; enabled: boolean })
  | (Mutation & { type: 'room:setOptions'; offlineTakeover: boolean; aiTier?:AiTier; endgameFix?:boolean })
  | (Mutation & { type: 'room:kick'; playerId: string })
  | (Mutation & { type: 'room:fillAi' | 'room:dissolve' | 'room:start' | 'room:leave' | 'room:rematch' })
  | (Mutation & { type: 'game:action'; handId: string; action: OnlineAction })
  | (Base & { type: 'game:snapshot' | 'game:replay'; roomCode: string });

export const ERROR_MESSAGES = {
  INVALID_REQUEST: '请求格式不正确，请刷新牌桌后重试。',
  VERSION_MISMATCH: '客户端版本与牌桌服务器不一致，请刷新页面。',
  ROOM_NOT_FOUND: '这个牌局不存在或已经结束。', ROOM_FULL: '这桌已经坐满。',
  INVALID_TOKEN: '无法恢复这个座位，请核对房间号和座位恢复码。',
  NOT_YOUR_TURN: '现在不是你的回合。', INVALID_ACTION: '这次操作不符合当前牌局规则。',
  STALE_STATE: '牌桌已经有新进展，已同步最新局面。', MATCH_FINISHED: '本场已经结束。',
  SERVER_ERROR: '牌桌服务器暂时无法完成操作，请稍后重试。',
  AI_UNAVAILABLE: '所选电脑策略的模型未就绪或版本不兼容，请保留牌局并检查服务器模型。',
  HOST_ONLY: '这项操作需要房主确认。', ROOM_ALREADY_STARTED: '牌局已经开始。',
  SEAT_OCCUPIED: '这个座位已经有人了。', NOT_READY: '请坐满四席，并等待所有真人准备。',
  SESSION_REPLACED: '此座位已在另一窗口重新连接。', RATE_LIMITED: '操作有些频繁，请稍等再试。',
  ACTION_ID_CONFLICT: '这次操作的标识已被使用，请重新操作。', REPLAY_UNAVAILABLE: '整场结束后才开放完整回放。',
  ROOM_LIMIT: '当前临时牌桌较多，请稍后再创建。',
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type Ack = { ok: true; protocolVersion: typeof PROTOCOL_VERSION; stateVersion?: number; serverSeq?: number;
  alreadyProcessed?: boolean; session?: PlayerSession; room?: RoomSnapshot; observation?: OnlineObservation; replay?: MatchJournal }
  | { ok: false; protocolVersion: typeof PROTOCOL_VERSION; code: ErrorCode; message: string; stateVersion?: number; serverSeq?: number };
export interface ConnectionStatus { protocolVersion: typeof PROTOCOL_VERSION; status: 'connected' | 'replaced' | 'removed' | 'closed' | 'left'; message: string }
export type ServerPush = { event: 'room:snapshot'; payload: RoomSnapshot }
  | { event: 'game:observation'; payload: OnlineObservation }
  | { event: 'connection:status'; payload: ConnectionStatus };
export type DirectedPush = ServerPush & { connectionId: string };
export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'game:observation': (observation: OnlineObservation) => void;
  'connection:status': (status: ConnectionStatus) => void;
}
export interface ClientToServerEvents { 'guan:request': (request: ClientRequest, ack: (result: Ack) => void) => void }
export class ProtocolError extends Error {
  constructor(readonly code: ErrorCode = 'INVALID_REQUEST') { super(ERROR_MESSAGES[code]); }
}
export const failure = (code: ErrorCode): Ack => ({ ok: false, protocolVersion: PROTOCOL_VERSION, code, message: ERROR_MESSAGES[code] });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ProtocolError();
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.length || value.length > max || pattern && !pattern.test(value)) throw new ProtocolError();
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new ProtocolError(); return value; }
function aiTier(value:unknown):AiTier {if(value!=='casual'&&value!=='balanced'&&value!=='balanced-plus'&&value!=='balanced-pro'&&value!=='jwxxc-pro'&&value!=='pro')throw new ProtocolError();return value;}
function seat(value: unknown): Seat { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 3) throw new ProtocolError(); return value as Seat; }
function nickname(value: unknown): string {
  const normalized = text(value, 96).trim().normalize('NFC');
  if (!normalized || [...normalized].length > 16 || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw new ProtocolError();
  return normalized;
}
function action(value: unknown): OnlineAction {
  if (!object(value)) throw new ProtocolError();
  switch (value.type) {
    case 'play': {
      keys(value, ['type', 'cardIds', 'playKey']);
      if (!Array.isArray(value.cardIds) || !value.cardIds.length || value.cardIds.length > 10 || new Set(value.cardIds).size !== value.cardIds.length) throw new ProtocolError();
      return { type: 'play', cardIds: value.cardIds.map(id => text(id, 80, /^[A-Za-z0-9-]+$/)), playKey: text(value.playKey, 5000) };
    }
    case 'pass': case 'nextHand': case 'beginHand': keys(value, ['type']); return { type: value.type };
    case 'tribute': case 'return': keys(value, ['type', 'cardId']); return { type: value.type, cardId: text(value.cardId, 80, /^[A-Za-z0-9-]+$/) };
    default: throw new ProtocolError();
  }
}
/** Strict runtime allowlist, shared by transport and tests. It returns a detached normalized request. */
export function parseRequest(value: unknown): ClientRequest {
  if (!object(value)) throw new ProtocolError();
  if (value.protocolVersion !== PROTOCOL_VERSION) throw new ProtocolError('VERSION_MISMATCH');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_REQUEST_BYTES) throw new ProtocolError();
  const base: Base = { protocolVersion: PROTOCOL_VERSION };
  const code = () => text(value.roomCode, 6, ROOM_CODE_PATTERN);
  const id = () => text(value.clientActionId, 80, /^[A-Za-z0-9_-]+$/);
  const common = ['protocolVersion', 'type', 'roomCode', 'clientActionId', 'expectedStateVersion'];
  switch (value.type) {
    case 'room:create': keys(value, ['protocolVersion','type','nickname','clientActionId','offlineTakeover','aiTier','endgameFix']); return { ...base,type:value.type,nickname:nickname(value.nickname),clientActionId:id(),...(value.offlineTakeover===undefined?{}:{offlineTakeover:bool(value.offlineTakeover)}),...(value.aiTier===undefined?{}:{aiTier:aiTier(value.aiTier)}),...(value.endgameFix===undefined?{}:{endgameFix:bool(value.endgameFix)}) };
    case 'room:join': keys(value, ['protocolVersion','type','roomCode','nickname','clientActionId']); return { ...base,type:value.type,roomCode:code(),nickname:nickname(value.nickname),clientActionId:id() };
    case 'room:resume': keys(value, ['protocolVersion','type','roomCode','playerToken']); return { ...base,type:value.type,roomCode:code(),playerToken:text(value.playerToken,64,/^[a-f0-9]{64}$/) };
    case 'room:recover': keys(value, ['protocolVersion','type','roomCode','recoveryCode']); return { ...base,type:value.type,roomCode:code(),recoveryCode:text(value.recoveryCode,64,/^[a-f0-9]{64}$/) };
    case 'game:snapshot': case 'game:replay': keys(value,['protocolVersion','type','roomCode']);return { ...base,type:value.type,roomCode:code() };
  }
  if (!Number.isSafeInteger(value.expectedStateVersion) || Number(value.expectedStateVersion) < 0) throw new ProtocolError();
  const mutation: Mutation = { ...base,roomCode:code(),clientActionId:id(),expectedStateVersion:Number(value.expectedStateVersion) };
  switch (value.type) {
    case 'room:selectSeat': keys(value,[...common,'seat']);return { ...mutation,type:value.type,seat:seat(value.seat) };
    case 'room:setReady': keys(value,[...common,'ready']);return { ...mutation,type:value.type,ready:bool(value.ready) };
    case 'room:setAiSeat': keys(value,[...common,'seat','enabled']);return { ...mutation,type:value.type,seat:seat(value.seat),enabled:bool(value.enabled) };
    case 'room:setOptions': keys(value,[...common,'offlineTakeover','aiTier','endgameFix']);return { ...mutation,type:value.type,offlineTakeover:bool(value.offlineTakeover),...(value.aiTier===undefined?{}:{aiTier:aiTier(value.aiTier)}),...(value.endgameFix===undefined?{}:{endgameFix:bool(value.endgameFix)}) };
    case 'room:kick': keys(value,[...common,'playerId']);return { ...mutation,type:value.type,playerId:text(value.playerId,80,/^[A-Za-z0-9_-]+$/) };
    case 'room:fillAi': case 'room:dissolve': case 'room:start': case 'room:leave': case 'room:rematch': keys(value,common);return { ...mutation,type:value.type };
    case 'game:action': keys(value,[...common,'handId','action']);return { ...mutation,type:value.type,handId:text(value.handId,199),action:action(value.action) };
    default: throw new ProtocolError();
  }
}
