import { randomId } from '../game/randomId';
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, REQUEST_EVENT, failure, type Ack, type ClientRequest, type ClientToServerEvents, type ServerToClientEvents, type RoomSnapshot, type OnlineObservation, type PlayerSession } from './protocol';
import { forgetOnlineSession, loadOnlineSession, saveOnlineSession } from './storage';
import { onlineEntries } from '../statistics/recording';
import { saveStatistics } from '../statistics/storage';

type StripMutation<T> = T extends { expectedStateVersion: number } ? Omit<T, 'protocolVersion' | 'roomCode' | 'clientActionId' | 'expectedStateVersion'> : never;
export type MutationIntent = StripMutation<ClientRequest>;
export interface OnlineClientState {
  connection: 'connecting' | 'online' | 'reconnecting' | 'offline' | 'replaced';
  authenticated: boolean; room: RoomSnapshot | null; observation: OnlineObservation | null; session: PlayerSession | null;
  pending: boolean; slow: boolean; notice: string; presentationEpoch: number;
}
export const emptyOnlineState = (): OnlineClientState => ({ connection: 'connecting', authenticated: false, room: null, observation: null, session: null, pending: false, slow: false, notice: '', presentationEpoch: 0 });

/** Client UI keeps a private observation. It never deals, applies an action, or predicts authority. */
export class OnlineConnection {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private state: OnlineClientState;
  private closed = false;
  private blocked = false;
  private generation = 0;
  private confirmedGeneration = -1;
  private pendingId: string | null = null;
  private slowTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private entryRetry?: { generation: number; signature: string; request: ClientRequest };
  constructor(private readonly initialRoom: string | null, private readonly publish: (state: OnlineClientState) => void) {
    this.state = { ...emptyOnlineState(), session: initialRoom ? loadOnlineSession(initialRoom) : null };
    // Same origin in production, including a newly generated Quick Tunnel URL.
    this.socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true,
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 10_000, forceNew: true });
    this.socket.on('room:snapshot', room => this.acceptRoom(room));
    this.socket.on('game:observation', observation => this.acceptObservation(observation));
    this.socket.on('connection:status', status => {
      if (!this.compatible(status)) return;
      if (status.status === 'connected') return;
      this.blocked = true; this.generation++; this.pendingId = null; clearTimeout(this.slowTimer);
      if (status.status !== 'replaced' && status.status !== 'left' && this.state.session) forgetOnlineSession(this.state.session.roomCode);
      this.update({ connection: 'replaced', authenticated: false, pending: false, slow: false, notice: status.message });
      // Become read-only immediately, but keep this transport long enough to receive
      // the explicit ACK for our own leave/dissolve. Authority already fenced this socket.
      this.socket.io.reconnection(false);
    });
    this.socket.on('connect', () => {
      if (this.closed || this.blocked) return;
      this.generation++;
      const session = this.state.session;
      if (!session) { this.update({ connection: 'online', authenticated: false, notice: '' }); return; }
      this.resumeSession();
    });
    this.socket.on('disconnect', reason => {
      if (this.closed || this.blocked) return;
      this.generation++; this.pendingId = null; clearTimeout(this.slowTimer);
      this.update({ connection: 'reconnecting', authenticated: false, pending: false, slow: false, notice: '与牌桌失去连接，正在重连。房主的联机服务可能已经关闭。' });
      if (reason === 'io server disconnect') this.reconnectTimer = setTimeout(() => { if (!this.closed && !this.blocked) this.socket.connect(); }, 1000);
    });
    this.socket.on('connect_error', () => {
      if (!this.closed && !this.blocked) this.update({ connection: 'offline', authenticated: false, notice: '暂时连接不到牌桌。请确认房主的联机服务仍在运行。' });
    });
  }
  connect(): void { this.publish(this.state); this.socket.connect(); }
  private resumeSession(): void {
    const session = this.state.session;
    if (!session || this.pendingId) return;
    this.update({ connection: 'reconnecting', authenticated: false, notice: '正在恢复原座位…', presentationEpoch: this.state.presentationEpoch + 1 });
    const resumeGeneration = this.generation;
    void this.request({ protocolVersion: PROTOCOL_VERSION, type: 'room:resume', roomCode: session.roomCode, playerToken: session.playerToken }, true).then(ack => {
      if (this.closed || this.blocked || resumeGeneration !== this.generation) return;
      if (ack.ok) this.update({ connection: 'online', notice: '', presentationEpoch: this.state.presentationEpoch + 1 });
      else this.update({ connection: 'online', authenticated: false, room: null, observation: null, notice: ack.message });
    });
  }
  private statisticsStamp = '';
  private update(patch: Partial<OnlineClientState>, dateLiveResult = true): void {
    if (this.closed) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    const { authenticated, room, observation, session } = this.state;
    if (authenticated && room && observation && session && room.stateVersion === observation.stateVersion) {
      const stamp = `${room.matchId}:${observation.stateVersion}:${session.seat}`;
      if (stamp !== this.statisticsStamp) {
        const liveHandId = dateLiveResult && previous.authenticated && previous.connection === 'online' && !previous.observation?.result ? previous.observation?.game.handId : undefined;
        const error = saveStatistics(onlineEntries(room, observation, session, Date.now(), liveHandId));
        if (error) this.state.notice = error;
        else this.statisticsStamp = stamp;
      }
    }
    this.publish(this.state);
  }
  private compatible(value: { protocolVersion?: string } | null | undefined): boolean {
    if (value?.protocolVersion === PROTOCOL_VERSION) return true;
    this.update({ notice: '客户端版本与牌桌服务器不一致，请刷新页面。' }); return false;
  }
  private acceptsRoomCode(code: string): boolean { return code === (this.state.session?.roomCode ?? this.initialRoom) || !this.state.session && !this.initialRoom; }
  private acceptRoom(room: RoomSnapshot): void {
    // Bootstrap emits public pushes before its private ACK. Keep the entry
    // form available until this connection has confirmed its seat identity.
    if (this.closed || this.blocked || this.confirmedGeneration !== this.generation || !this.compatible(room) || !this.acceptsRoomCode(room.roomCode)) return;
    if (this.state.room?.roomCode === room.roomCode && room.stateVersion < this.state.room.stateVersion) return;
    const player = room.seats.find(seat => seat.playerId === this.state.session?.playerId);
    let session = this.state.session;
    if (session && player && player.seat !== session.seat) { session = { ...session, seat: player.seat }; saveOnlineSession(session); }
    this.update({ room, session });
  }
  private acceptObservation(observation: OnlineObservation, dateLiveResult = true): void {
    if (this.closed || this.blocked || this.confirmedGeneration !== this.generation || !this.compatible(observation) || !this.acceptsRoomCode(observation.roomCode)) return;
    if (this.state.observation?.roomCode === observation.roomCode && observation.stateVersion < this.state.observation.stateVersion) return;
    this.update({ observation }, dateLiveResult);
  }
  private acceptAck(ack: Ack): void {
    if (!ack.ok) { this.update({ notice: ack.message }); return; }
    // A successful snapshot also proves a saved identity is bound, including
    // an explicit sync after a resume ACK was lost on this transport.
    if (ack.session || ack.room && this.state.session?.roomCode === ack.room.roomCode) this.confirmedGeneration = this.generation;
    if (ack.session) {
      const previous = this.state.session?.playerId === ack.session.playerId ? this.state.session : null;
      const session = { ...previous, ...ack.session };
      const stored = saveOnlineSession(session);
      this.update({ session, authenticated: true, connection: 'online', notice: stored ? '' : '浏览器无法保存身份。请复制座位恢复码，方便刷新或换网址后找回座位。' });
    }
    if (ack.room) this.acceptRoom(ack.room);
    if (ack.observation) this.acceptObservation(ack.observation, false);
  }
  async request(request: ClientRequest, mutation: boolean): Promise<Ack> {
    if (this.closed || this.blocked || !this.socket.connected) return failure('SERVER_ERROR');
    if (mutation && this.pendingId) return failure('RATE_LIMITED');
    const epoch = this.generation, requestId = randomId();
    if (mutation) {
      this.pendingId = requestId; this.update({ pending: true, slow: false, notice: '' });
      this.slowTimer = setTimeout(() => { if (this.pendingId === requestId) this.update({ slow: true, notice: '网络似乎有些慢，正在等待牌桌确认。' }); }, 2500);
    }
    return new Promise(resolve => {
      // No offline mutation buffer or automatic action retry across reconnection.
      this.socket.volatile.timeout(8000).emit(REQUEST_EVENT, request, (error: Error | null, response: Ack) => {
        if (this.closed) { resolve(failure('STALE_STATE')); return; }
        if (this.blocked || epoch !== this.generation) {
          const terminal = request.type === 'room:leave' || request.type === 'room:dissolve';
          resolve(terminal && !error && response?.ok && response.protocolVersion === PROTOCOL_VERSION ? response : failure('STALE_STATE')); return;
        }
        if (mutation && this.pendingId === requestId) { this.pendingId = null; clearTimeout(this.slowTimer); this.update({ pending: false, slow: false }); }
        if(response&&!this.compatible(response)){const ack=failure('VERSION_MISMATCH');this.update({notice:'客户端与牌桌服务器版本不兼容，请确认房主已更新服务后刷新页面。'});resolve(ack);return;}
        if (error || !response) {
          const ack = failure('SERVER_ERROR'); this.update({ notice: '这次操作尚未得到确认，请同步牌桌后再操作。' }); resolve(ack); return;
        }
        this.acceptAck(response); resolve(response);
      });
    });
  }
  async create(nickname: string, offlineTakeover: boolean): Promise<Ack> {
    return this.enter({ protocolVersion: PROTOCOL_VERSION, type: 'room:create', nickname, offlineTakeover, clientActionId: randomId() });
  }
  async join(roomCode: string, nickname: string): Promise<Ack> {
    return this.enter({ protocolVersion: PROTOCOL_VERSION, type: 'room:join', roomCode, nickname, clientActionId: randomId() });
  }
  async recover(roomCode: string, recoveryCode: string): Promise<Ack> {
    return this.enter({ protocolVersion: PROTOCOL_VERSION, type: 'room:recover', roomCode, recoveryCode: recoveryCode.replace(/[\s-]/g, '').toLowerCase() });
  }
  private async enter(request: ClientRequest): Promise<Ack> {
    let retry: typeof this.entryRetry;
    if ((request.type === 'room:create' || request.type === 'room:join') && !this.pendingId && !this.closed && !this.blocked && this.socket.connected) {
      const signature = JSON.stringify({ ...request, clientActionId: undefined });
      retry = this.entryRetry?.generation === this.generation && this.entryRetry.signature === signature
        ? this.entryRetry : { generation: this.generation, signature, request };
      this.entryRetry = retry;
      // A lost ACK may already have created the room/seat. The same explicit
      // retry on this connection must retrieve that private bootstrap ACK.
      request = retry.request;
    }
    const result = await this.request(request, true);
    if (retry && this.entryRetry === retry && (result.ok || result.code !== 'SERVER_ERROR')) this.entryRetry = undefined;
    if (result.ok && result.session && !this.closed) {
      history.replaceState(null, '', `/room/${result.session.roomCode}`);
      this.update({ presentationEpoch: this.state.presentationEpoch + 1 });
    }
    return result;
  }
  mutate(intent: MutationIntent): Promise<Ack> {
    const room = this.state.room;
    if (!this.state.authenticated || !room) return Promise.resolve(failure('INVALID_TOKEN'));
    if (intent.type === 'game:action' && this.state.observation?.stateVersion !== room.stateVersion) {
      void this.refresh(); return Promise.resolve(failure('STALE_STATE'));
    }
    return this.request({ ...intent, protocolVersion: PROTOCOL_VERSION, roomCode: room.roomCode, expectedStateVersion: room.stateVersion, clientActionId: randomId() } as ClientRequest, true);
  }
  async refresh(): Promise<Ack> {
    const session = this.state.session;
    if (!session || this.closed || this.blocked || !this.socket.connected) return failure('INVALID_TOKEN');
    const epoch = this.generation;
    this.update({ authenticated: false, connection: 'reconnecting', presentationEpoch: this.state.presentationEpoch + 1, notice: '正在同步牌桌…' });
    const result = await this.request({ protocolVersion: PROTOCOL_VERSION, type: 'game:snapshot', roomCode: session.roomCode }, false);
    if (result.ok && !this.closed && !this.blocked && epoch === this.generation) this.update({ authenticated: true, connection: 'online', presentationEpoch: this.state.presentationEpoch + 1, notice: '' });
    return result;
  }
  replay(): Promise<Ack> { return this.state.session ? this.request({ protocolVersion: PROTOCOL_VERSION, type: 'game:replay', roomCode: this.state.session.roomCode }, false) : Promise.resolve(failure('INVALID_TOKEN')); }
  reconnect(): void {
    if (this.blocked) return;
    if (!this.socket.connected) this.socket.connect();
    else if (!this.state.authenticated && this.state.session) this.resumeSession();
    else void this.refresh();
  }
  clearNotice(): void { this.update({ notice: '' }); }
  close(): void { this.closed = true; this.generation++; clearTimeout(this.slowTimer); clearTimeout(this.reconnectTimer); this.socket.removeAllListeners(); this.socket.disconnect(); }
}
