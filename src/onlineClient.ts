import { voiceChat } from './voiceChat';
import { soundEngine } from './soundEffects.js';

export interface PlayerInfo {
  token: string;
  name: string;
  connected: boolean;
  color: 'w' | 'b' | 'spectator';
  lastSeen?: number;
}

export interface ChatMessage {
  id: string;
  sender: 'w' | 'b' | 'spectator' | 'system';
  senderName: string;
  text: string;
  ts: number;
  isEmote?: boolean;
}

export interface OnlineRoomData {
  code: string;
  name: string;
  status: 'waiting' | 'playing' | 'ended';
  timeControl: 'none' | '3m' | '5m' | '10m';
  whiteTimeRemaining: number;
  blackTimeRemaining: number;
  lastTurnSwitchTs: number;
  white: PlayerInfo | null;
  black: PlayerInfo | null;
  spectators: PlayerInfo[];
  turn: 'w' | 'b';
  moves: any[];
  resetCount: number;
  chat: ChatMessage[];
  drawOffer: 'w' | 'b' | null;
  rematchOffers: string[];
  winner: 'w' | 'b' | 'draw' | null;
  winReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OnlineClientState {
  mode: 'single' | 'local2p' | 'online2p';
  roomCode: string | null;
  playerColor: 'w' | 'b';
  role: 'w' | 'b' | 'spectator';
  playerName: string;
  opponentName: string;
  connected: boolean;
  whiteConnected: boolean;
  blackConnected: boolean;
  pingMs: number;
  status: 'idle' | 'waiting' | 'playing' | 'ended';
  turn: 'w' | 'b';
  timeControl: 'none' | '3m' | '5m' | '10m';
  whiteTime: number;
  blackTime: number;
  statusMessage: string;
  autoFlipCamera: boolean;
  chatMessages: ChatMessage[];
  drawOfferedByMe: boolean;
  drawOfferedToMe: boolean;
  rematchRequestedByMe: boolean;
  rematchRequestedByOpponent: boolean;
  winner: 'w' | 'b' | 'draw' | null;
  winReason: string | null;
  spectatorsCount: number;
}

export type OnlineStateListener = (state: OnlineClientState) => void;

class OnlineManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private clockInterval: any = null;
  private appliedMoveSeq = 0;
  private appliedResetCount = 0;
  private listeners: Set<OnlineStateListener> = new Set();
  public playerToken: string = '';

  public state: OnlineClientState = {
    mode: 'single',
    roomCode: null,
    playerColor: 'w',
    role: 'w',
    playerName: 'Archmage',
    opponentName: 'Opponent',
    connected: false,
    whiteConnected: false,
    blackConnected: false,
    pingMs: 0,
    status: 'idle',
    turn: 'w',
    timeControl: 'none',
    whiteTime: 0,
    blackTime: 0,
    statusMessage: 'Ready to play',
    autoFlipCamera: true,
    chatMessages: [],
    drawOfferedByMe: false,
    drawOfferedToMe: false,
    rematchRequestedByMe: false,
    rematchRequestedByOpponent: false,
    winner: null,
    winReason: null,
    spectatorsCount: 0
  };

  constructor() {
    try {
      this.playerToken = localStorage.getItem('wizard_chess_token') || '';
      if (!this.playerToken) {
        this.playerToken = 'tok_' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('wizard_chess_token', this.playerToken);
      }
      const savedName = localStorage.getItem('wizard_chess_player_name');
      if (savedName) {
        this.state.playerName = savedName;
      } else {
        const randNum = Math.floor(100 + Math.random() * 900);
        this.state.playerName = `Archmage ${randNum}`;
        localStorage.setItem('wizard_chess_player_name', this.state.playerName);
      }
    } catch (e) {
      this.playerToken = 'tok_' + Math.random().toString(36).slice(2, 12);
    }

    voiceChat.setSendWebSocket((msg) => this.send(msg));

    // Start local clock ticker
    this.startClockTicker();
  }

  public setPlayerName(name: string) {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return;
    this.state.playerName = clean;
    try {
      localStorage.setItem('wizard_chess_player_name', clean);
    } catch (e) {}
    this.notify();
  }

  public subscribe(listener: OnlineStateListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener({ ...this.state });
      } catch (e) {
        console.warn('Online state listener error:', e);
      }
    }
  }

  public setMode(mode: 'single' | 'local2p' | 'online2p') {
    if (this.state.mode === 'online2p' && mode !== 'online2p') {
      this.leaveRoom();
    }
    this.state.mode = mode;
    if (mode === 'single') {
      this.state.statusMessage = 'Playing vs AI';
      const win = window as any;
      if (win.wizardChess?.setSinglePlayerSide) {
        win.wizardChess.setSinglePlayerSide(this.state.playerColor);
      }
    } else if (mode === 'local2p') {
      this.state.statusMessage = 'Local 2 Players (Pass & Play)';
    }
    this.notify();
  }

  public toggleAutoFlip(): boolean {
    this.state.autoFlipCamera = !this.state.autoFlipCamera;
    this.notify();
    return this.state.autoFlipCamera;
  }

  public send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // =========================================================================
  // Matchmaking & Room Management
  // =========================================================================

  public async quickMatch(
    timeControl: 'none' | '3m' | '5m' | '10m' | 'any' = 'none',
    preferredColor: 'w' | 'b' | 'random' = 'random'
  ) {
    this.state.mode = 'online2p';
    this.state.statusMessage = 'Searching for an opponent in the Sanctum...';
    this.state.status = 'waiting';
    this.notify();

    this.connectWebSocket('', 'w', {
      quickMatch: true,
      timeControl,
      preferredColor
    });
  }

  public async createRoom(
    preferredColor: 'w' | 'b' = 'w',
    timeControl: 'none' | '3m' | '5m' | '10m' = 'none',
    password?: string
  ): Promise<string | null> {
    try {
      this.state.statusMessage = 'Creating online room...';
      this.notify();

      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredColor,
          playerToken: this.playerToken,
          playerName: this.state.playerName,
          timeControl,
          password: password ? password.trim() : undefined
        })
      });

      if (!res.ok) throw new Error('Server error creating room');
      const data = await res.json();
      if (!data.ok || !data.code) throw new Error(data.error || 'Failed to create room');

      this.state.mode = 'online2p';
      this.state.roomCode = data.code;
      this.state.playerColor = data.color;
      this.state.role = data.role || data.color;
      this.state.timeControl = timeControl;
      this.appliedMoveSeq = 0;
      this.appliedResetCount = 0;
      this.state.statusMessage = `Room ${data.code} created! Waiting for opponent...`;
      this.state.status = 'waiting';
      this.notify();

      this.connectWebSocket(data.code, data.color, { password });

      const win = window as any;
      if (win.wizardChess?.startOnlineGame) {
        win.wizardChess.startOnlineGame(data.code, data.color);
      }

      if (data.room) {
        this.applyRemoteRoom(data.room);
      }

      return data.code;
    } catch (err: any) {
      this.state.statusMessage = `Error: ${err.message}`;
      this.notify();
      return null;
    }
  }

  public async joinRoom(
    code: string,
    password?: string
  ): Promise<{ ok: boolean; requirePassword?: boolean; error?: string }> {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) {
      this.state.statusMessage = 'Please enter a valid room code';
      this.notify();
      return { ok: false, error: 'Please enter a valid room code' };
    }

    try {
      this.state.statusMessage = `Entering Sanctum ${cleanCode}...`;
      this.notify();

      const res = await fetch(`/api/rooms/${cleanCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          playerToken: this.playerToken,
          playerName: this.state.playerName,
          password: password ? password.trim() : undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || data.requirePassword) {
        return { ok: false, requirePassword: true, error: data.error || 'Password required' };
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Room not found or server error');
      }

      this.state.mode = 'online2p';
      this.state.roomCode = cleanCode;
      this.state.playerColor = data.color || 'w';
      this.state.role = data.role || data.color || 'w';
      this.appliedMoveSeq = 0;
      this.appliedResetCount = data.room?.resetCount || 0;
      this.state.statusMessage =
        data.role === 'spectator'
          ? `Spectating Room ${cleanCode}`
          : `Connected to Room ${cleanCode}! Playing as ${data.color === 'w' ? 'White' : 'Black'}`;
      this.notify();

      this.connectWebSocket(cleanCode, data.color, { password });

      const win = window as any;
      if (win.wizardChess?.startOnlineGame) {
        win.wizardChess.startOnlineGame(cleanCode, data.color);
      }

      if (data.room) {
        this.applyRemoteRoom(data.room);
      }

      return { ok: true };
    } catch (err: any) {
      this.state.statusMessage = `Error: ${err.message}`;
      this.notify();
      return { ok: false, error: err.message };
    }
  }

  public leaveRoom() {
    voiceChat.stopVoice();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.state.roomCode) {
      const code = this.state.roomCode;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
            JSON.stringify({
              type: 'leave_room',
              roomCode: code,
              playerToken: this.playerToken
            })
          );
        } catch (e) {}
      }
      fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerToken: this.playerToken })
      }).catch(() => {});
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    this.state.mode = 'single';
    this.state.roomCode = null;
    this.state.connected = false;
    this.state.whiteConnected = false;
    this.state.blackConnected = false;
    this.state.status = 'idle';
    this.state.statusMessage = 'Left room. Returned to Solo Sanctum';
    this.state.chatMessages = [];
    this.state.drawOfferedByMe = false;
    this.state.drawOfferedToMe = false;
    this.state.rematchRequestedByMe = false;
    this.state.rematchRequestedByOpponent = false;
    this.state.winner = null;
    this.state.winReason = null;
    this.appliedMoveSeq = 0;
    this.notify();

    const win = window as any;
    if (win.wizardChess?.stopOnlineGame) {
      win.wizardChess.stopOnlineGame();
    }
  }

  // =========================================================================
  // Game Actions: Move, Chat, Resign, Draw, Rematch
  // =========================================================================

  public sendMove(
    from: { r: number; c: number },
    to: { r: number; c: number },
    promotion = 'queen',
    san = ''
  ) {
    if (this.state.mode === 'online2p' && this.state.roomCode) {
      const movePayload = {
        color: this.state.playerColor,
        from,
        to,
        promotion,
        san
      };
      this.send({
        type: 'move',
        roomCode: this.state.roomCode,
        playerToken: this.playerToken,
        move: movePayload
      });
      fetch(`/api/rooms/${this.state.roomCode}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movePayload)
      }).catch(() => {});
    }
  }

  public sendChat(text: string, isEmote = false) {
    const cleanText = String(text || '').trim();
    if (!cleanText || !this.state.roomCode) return;
    this.send({
      type: 'chat',
      roomCode: this.state.roomCode,
      playerToken: this.playerToken,
      text: cleanText,
      isEmote
    });
  }

  public resign() {
    if (!this.state.roomCode || this.state.role === 'spectator') return;
    this.send({
      type: 'resign',
      roomCode: this.state.roomCode,
      playerToken: this.playerToken
    });
    // Reliable HTTP fallback
    fetch(`/api/rooms/${encodeURIComponent(this.state.roomCode)}/resign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerToken: this.playerToken, role: this.state.playerColor })
    }).catch(() => {});
  }

  public offerDraw() {
    if (!this.state.roomCode || this.state.role === 'spectator') return;
    this.state.drawOfferedByMe = true;
    this.notify();
    this.send({
      type: 'draw_offer',
      roomCode: this.state.roomCode,
      playerToken: this.playerToken
    });
  }

  public respondDraw(accept: boolean) {
    if (!this.state.roomCode) return;
    this.state.drawOfferedToMe = false;
    this.notify();
    this.send({
      type: 'draw_response',
      roomCode: this.state.roomCode,
      playerToken: this.playerToken,
      accept
    });
  }

  public requestRematch() {
    if (!this.state.roomCode) return;
    this.state.rematchRequestedByMe = true;
    this.notify();
    this.send({
      type: 'rematch_request',
      roomCode: this.state.roomCode,
      playerToken: this.playerToken
    });
  }

  public resetGame() {
    if (this.state.mode === 'online2p' && this.state.roomCode) {
      this.send({ type: 'reset', roomCode: this.state.roomCode });
      fetch(`/api/rooms/${this.state.roomCode}/reset`, { method: 'POST' }).catch(() => {});
    } else {
      const win = window as any;
      if (win.wizardChess?.resetChessBoard) {
        win.wizardChess.resetChessBoard(true, false);
      }
    }
  }

  // =========================================================================
  // WebSocket Connection & Real-time Signaling
  // =========================================================================

  private connectWebSocket(
    roomCode: string,
    color: 'w' | 'b',
    options?: { quickMatch?: boolean; timeControl?: string; preferredColor?: string; password?: string }
  ) {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.state.connected = true;
        this.notify();

        if (options?.quickMatch) {
          this.send({
            type: 'quick_match',
            playerToken: this.playerToken,
            playerName: this.state.playerName,
            timeControl: options.timeControl || 'none',
            preferredColor: options.preferredColor || 'random'
          });
        } else if (roomCode) {
          this.send({
            type: 'join',
            roomCode,
            playerToken: this.playerToken,
            playerName: this.state.playerName,
            preferredColor: color,
            timeControl: this.state.timeControl,
            password: options?.password
          });
        }

        // Start periodic ping latency measurement
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'ping', clientTs: Date.now() });
          }
        }, 5000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSocketMessage(data);
        } catch (err) {
          console.warn('WS message parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.state.connected = false;
        this.notify();
        if (this.state.mode === 'online2p' && this.state.roomCode) {
          this.reconnectTimer = setTimeout(() => {
            if (this.state.roomCode) {
              this.connectWebSocket(this.state.roomCode, this.state.playerColor);
            }
          }, 2000);
        }
      };

      this.ws.onerror = () => {
        this.state.connected = false;
        this.notify();
      };
    } catch (err) {
      console.warn('WebSocket connection error:', err);
    }
  }

  private handleSocketMessage(data: any) {
    if (!data || !data.type) return;

    if (data.type === 'pong') {
      const rtt = Date.now() - (data.clientTs || Date.now());
      this.state.pingMs = Math.max(1, rtt);
      this.notify();
    } else if (data.type === 'joined') {
      if (data.room) {
        this.state.roomCode = data.room.code;
        this.state.playerColor = data.color || 'w';
        this.state.role = data.role || data.color || 'w';
        this.state.timeControl = data.room.timeControl || 'none';
        this.applyRemoteRoom(data.room);

        const win = window as any;
        if (win.wizardChess?.startOnlineGame) {
          win.wizardChess.startOnlineGame(data.room.code, data.color);
        }
      }
    } else if (data.type === 'room_state') {
      if (data.room) {
        this.applyRemoteRoom(data.room);
      }
    } else if (data.type === 'peer_joined') {
      if (data.room) {
        this.applyRemoteRoom(data.room);
      } else {
        this.state.whiteConnected = true;
        this.state.blackConnected = true;
        this.state.status = 'playing';
      }
      this.state.statusMessage = 'Both players connected!';
      soundEngine.playSelectSound();
      this.notify();

      // If we are White, start WebRTC voice offer if microphone is active
      if (this.state.playerColor === 'w' && voiceChat.state.connected && this.state.roomCode) {
        voiceChat.startVoice(this.state.roomCode, true, (stream) => {
          this.attachRemoteAudio(stream);
        });
      }
    } else if (data.type === 'peer_left') {
      this.state.statusMessage = 'Opponent disconnected. Waiting for reconnect...';
      if (data.color === 'w') this.state.whiteConnected = false;
      if (data.color === 'b') this.state.blackConnected = false;
      this.notify();
    } else if (data.type === 'move') {
      if (data.move) {
        const win = window as any;
        if (win.wizardChess?.executeChessMove) {
          win.wizardChess.executeChessMove(
            data.move.from.r,
            data.move.from.c,
            data.move.to.r,
            data.move.to.c,
            { fromRemote: true, promotion: data.move.promotion || 'queen' }
          );
        }
      }
      if (data.room) {
        this.applyRemoteRoom(data.room);
      }
    } else if (data.type === 'clock_sync') {
      if (typeof data.whiteTime === 'number') this.state.whiteTime = data.whiteTime;
      if (typeof data.blackTime === 'number') this.state.blackTime = data.blackTime;
      if (data.turn) this.state.turn = data.turn;
      this.notify();
    } else if (data.type === 'chat') {
      if (data.message) {
        this.state.chatMessages.push(data.message);
        if (this.state.chatMessages.length > 80) this.state.chatMessages.shift();
        soundEngine.playSelectSound();
        this.notify();
      }
    } else if (data.type === 'draw_offered') {
      if (data.by !== this.state.playerColor) {
        this.state.drawOfferedToMe = true;
        soundEngine.playSelectSound();
        this.notify();
      }
    } else if (data.type === 'draw_declined') {
      this.state.drawOfferedByMe = false;
      this.state.statusMessage = 'Draw offer declined.';
      this.notify();
    } else if (data.type === 'game_over') {
      this.state.status = 'ended';
      this.state.winner = data.winner;
      this.state.winReason = data.reason || data.message;
      this.state.statusMessage = data.message || 'Game Over';
      soundEngine.playCheckmateBellSound();
      this.notify();
      if (data.room) {
        this.applyRemoteRoom(data.room);
      }

      // Notify 3D wizard chess engine to end game, strike king, and show victory banner
      const win = window as any;
      if (win.wizardChess?.triggerCheckmateSequence && data.winner) {
        const defeatedColor = data.winner === 'w' ? 'b' : 'w';
        win.wizardChess.triggerCheckmateSequence(defeatedColor, data.winner);
      }
    } else if (data.type === 'rematch_requested') {
      if (data.by !== this.state.playerColor) {
        this.state.rematchRequestedByOpponent = true;
        soundEngine.playSelectSound();
        this.notify();
      }
    } else if (data.type === 'rematch_started') {
      this.state.rematchRequestedByMe = false;
      this.state.rematchRequestedByOpponent = false;
      this.state.winner = null;
      this.state.winReason = null;
      this.state.status = 'playing';
      this.appliedMoveSeq = 0;

      // Update player color if swapped
      if (data.room) {
        if (data.room.white?.token === this.playerToken) this.state.playerColor = 'w';
        else if (data.room.black?.token === this.playerToken) this.state.playerColor = 'b';
        this.applyRemoteRoom(data.room);
      }

      const win = window as any;
      if (win.wizardChess?.resetChessBoard) {
        win.wizardChess.resetChessBoard(true, false);
      }
      this.state.statusMessage = 'Rematch started! Good luck!';
      this.notify();
    } else if (data.type === 'reset') {
      const win = window as any;
      if (win.wizardChess?.resetChessBoard) {
        win.wizardChess.resetChessBoard(false, false);
      }
      this.state.statusMessage = 'Game reset.';
      this.state.winner = null;
      this.state.winReason = null;
      this.notify();
    } else if (
      data.type === 'voice_offer' ||
      data.type === 'voice_answer' ||
      data.type === 'voice_ice' ||
      data.type === 'voice_status'
    ) {
      voiceChat.handleSignal(data);
    }
  }

  private applyRemoteRoom(room: OnlineRoomData) {
    this.state.turn = room.turn;
    this.state.status = room.status;
    this.state.whiteConnected = Boolean(room.white?.connected);
    this.state.blackConnected = Boolean(room.black?.connected);
    this.state.timeControl = room.timeControl;
    this.state.whiteTime = room.whiteTimeRemaining;
    this.state.blackTime = room.blackTimeRemaining;
    this.state.spectatorsCount = room.spectators?.length || 0;
    this.state.winner = room.winner;
    this.state.winReason = room.winReason;

    if (room.chat && Array.isArray(room.chat)) {
      this.state.chatMessages = [...room.chat];
    }

    if (this.state.playerColor === 'w') {
      this.state.opponentName = room.black?.name || 'Waiting for opponent...';
    } else {
      this.state.opponentName = room.white?.name || 'Waiting for opponent...';
    }

    if (room.status === 'playing') {
      this.state.statusMessage = `Game Active • Turn: ${room.turn === 'w' ? 'White' : 'Black'}`;
    } else if (room.status === 'waiting') {
      this.state.statusMessage = `Room ${room.code} ready • Share code or link with friend`;
    } else if (room.status === 'ended') {
      this.state.statusMessage = `Match ended: ${room.winReason || 'Game Over'}`;
    }

    this.notify();

    if (room.resetCount > this.appliedResetCount) {
      this.appliedResetCount = room.resetCount;
      this.appliedMoveSeq = 0;
      const win = window as any;
      if (win.wizardChess?.resetChessBoard) {
        win.wizardChess.resetChessBoard(false, false);
      }
    }

    if (Array.isArray(room.moves) && room.moves.length > this.appliedMoveSeq) {
      const win = window as any;
      for (let i = this.appliedMoveSeq; i < room.moves.length; i++) {
        const mv = room.moves[i];
        this.appliedMoveSeq = mv.seq || i + 1;
        if (win.wizardChess?.executeChessMove) {
          win.wizardChess.executeChessMove(mv.from.r, mv.from.c, mv.to.r, mv.to.c, {
            fromRemote: true,
            promotion: mv.promotion || 'queen'
          });
        }
      }
    }
  }

  private startClockTicker() {
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.clockInterval = setInterval(() => {
      if (
        this.state.mode === 'online2p' &&
        this.state.status === 'playing' &&
        this.state.timeControl !== 'none'
      ) {
        if (this.state.turn === 'w') {
          this.state.whiteTime = Math.max(0, this.state.whiteTime - 1);
        } else {
          this.state.blackTime = Math.max(0, this.state.blackTime - 1);
        }
        this.notify();
      }
    }, 1000);
  }

  public attachRemoteAudio(stream: MediaStream) {
    let audioEl = document.getElementById('remote-voice-audio') as HTMLAudioElement;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'remote-voice-audio';
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      document.body.appendChild(audioEl);
    }
    audioEl.muted = voiceChat.state.speakerMuted;
    audioEl.volume = voiceChat.state.speakerVolume;
    audioEl.srcObject = stream;
    audioEl.play().catch((err) => console.warn('Remote audio autoplay waiting for gesture:', err));
  }
}

export const onlineManager = new OnlineManager();
