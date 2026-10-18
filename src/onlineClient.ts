import { voiceChat } from './voiceChat';

export interface OnlineRoomState {
  code: string;
  status: 'waiting' | 'playing' | 'ended';
  whiteJoined: boolean;
  blackJoined: boolean;
  turn: 'w' | 'b';
  moves: any[];
  resetCount: number;
}

export interface OnlineClientState {
  mode: 'single' | 'local2p' | 'online2p';
  roomCode: string | null;
  playerColor: 'w' | 'b' | null;
  connected: boolean;
  whiteConnected: boolean;
  blackConnected: boolean;
  turn: 'w' | 'b';
  statusMessage: string;
  autoFlipCamera: boolean;
}

export type OnlineStateListener = (state: OnlineClientState) => void;

class OnlineManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private appliedMoveSeq = 0;
  private appliedResetCount = 0;
  private listeners: Set<OnlineStateListener> = new Set();
  private playerToken: string = localStorage.getItem('wizard_chess_token') || '';

  public state: OnlineClientState = {
    mode: 'single',
    roomCode: null,
    playerColor: 'w',
    connected: false,
    whiteConnected: false,
    blackConnected: false,
    turn: 'w',
    statusMessage: '',
    autoFlipCamera: true
  };

  constructor() {
    if (!this.playerToken) {
      this.playerToken = 'tok_' + Math.random().toString(36).slice(2, 12);
      try {
        localStorage.setItem('wizard_chess_token', this.playerToken);
      } catch (e) {}
    }

    voiceChat.setSendWebSocket((msg) => this.send(msg));
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
        win.wizardChess.setSinglePlayerSide('w');
      }
    } else if (mode === 'local2p') {
      this.state.statusMessage = 'Local 2 Players (Pass & Play)';
      const win = window as any;
      if (win.wizardChess?.setGameMode) {
        win.wizardChess.setGameMode('local2p');
      }
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

  public async createRoom(preferredColor: 'w' | 'b' = 'w'): Promise<string | null> {
    try {
      this.state.statusMessage = 'Creating online room...';
      this.notify();

      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredColor, playerToken: this.playerToken })
      });

      if (!res.ok) throw new Error('Server error creating room');
      const data = await res.json();
      if (!data.ok || !data.code) throw new Error(data.error || 'Failed to create room');

      this.state.mode = 'online2p';
      this.state.roomCode = data.code;
      this.state.playerColor = data.color;
      this.appliedMoveSeq = 0;
      this.appliedResetCount = 0;
      this.state.statusMessage = `Room ${data.code} created! Waiting for opponent...`;
      this.notify();

      this.connectWebSocket(data.code, data.color);

      const win = window as any;
      if (win.wizardChess?.startOnlineGame) {
        win.wizardChess.startOnlineGame(data.code, data.color);
      }

      return data.code;
    } catch (err: any) {
      this.state.statusMessage = `Error: ${err.message}`;
      this.notify();
      return null;
    }
  }

  public async joinRoom(code: string): Promise<boolean> {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) {
      this.state.statusMessage = 'Please enter a room code';
      this.notify();
      return false;
    }

    try {
      this.state.statusMessage = `Joining room ${cleanCode}...`;
      this.notify();

      const res = await fetch(`/api/rooms/${cleanCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerToken: this.playerToken })
      });

      if (!res.ok) throw new Error('Room not found or server error');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to join room');

      this.state.mode = 'online2p';
      this.state.roomCode = cleanCode;
      this.state.playerColor = data.color;
      this.appliedMoveSeq = 0;
      this.appliedResetCount = data.room.resetCount || 0;
      this.state.statusMessage = `Connected to Room ${cleanCode}! Playing as ${data.color === 'w' ? 'White' : 'Black'}`;
      this.notify();

      this.connectWebSocket(cleanCode, data.color);

      const win = window as any;
      if (win.wizardChess?.startOnlineGame) {
        win.wizardChess.startOnlineGame(cleanCode, data.color);
      }

      if (data.room) {
        this.applyRemoteRoom(data.room);
      }

      return true;
    } catch (err: any) {
      this.state.statusMessage = `Error: ${err.message}`;
      this.notify();
      return false;
    }
  }

  public leaveRoom() {
    voiceChat.stopVoice();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.state.roomCode = null;
    this.state.connected = false;
    this.state.whiteConnected = false;
    this.state.blackConnected = false;
    this.appliedMoveSeq = 0;
    this.notify();

    const win = window as any;
    if (win.wizardChess?.stopOnlineGame) {
      win.wizardChess.stopOnlineGame();
    }
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

  public sendMove(from: { r: number; c: number }, to: { r: number; c: number }, promotion = 'queen') {
    if (this.state.mode === 'online2p' && this.state.roomCode) {
      const movePayload = {
        color: this.state.playerColor,
        from,
        to,
        promotion
      };
      this.send({
        type: 'move',
        roomCode: this.state.roomCode,
        move: movePayload
      });
      fetch(`/api/rooms/${this.state.roomCode}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movePayload)
      }).catch(() => {});
    }
  }

  private connectWebSocket(roomCode: string, color: 'w' | 'b') {
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
        this.send({
          type: 'join',
          roomCode,
          playerToken: this.playerToken,
          color
        });
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
        if (this.state.mode === 'online2p' && this.state.roomCode === roomCode) {
          this.reconnectTimer = setTimeout(() => {
            this.connectWebSocket(roomCode, color);
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

    if (data.type === 'joined' || data.type === 'room_state') {
      if (data.room) {
        this.applyRemoteRoom(data.room);
      }
    } else if (data.type === 'peer_joined') {
      this.state.statusMessage = 'Both players connected!';
      this.state.whiteConnected = true;
      this.state.blackConnected = true;
      this.notify();

      // If we are White (host/initiator), start voice offer to incoming player
      if (this.state.playerColor === 'w' && voiceChat.state.connected) {
        // Trigger offer exchange
        voiceChat.startVoice(this.state.roomCode!, true, (stream) => {
          this.attachRemoteAudio(stream);
        });
      }
    } else if (data.type === 'peer_left') {
      this.state.statusMessage = 'Opponent disconnected. Waiting...';
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
    } else if (data.type === 'reset') {
      const win = window as any;
      if (win.wizardChess?.resetChessBoard) {
        win.wizardChess.resetChessBoard(false, false);
      }
      this.state.statusMessage = 'Game reset by opponent.';
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

  private applyRemoteRoom(room: OnlineRoomState) {
    this.state.turn = room.turn;
    this.state.whiteConnected = room.whiteJoined;
    this.state.blackConnected = room.blackJoined;

    if (room.whiteJoined && room.blackJoined) {
      this.state.statusMessage = `Game Active • Room ${room.code} • Turn: ${room.turn === 'w' ? 'White' : 'Black'}`;
    } else {
      this.state.statusMessage = `Room ${room.code} ready • Share code or link with Friend`;
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
        this.appliedMoveSeq = mv.seq || (i + 1);
        if (win.wizardChess?.executeChessMove) {
          win.wizardChess.executeChessMove(mv.from.r, mv.from.c, mv.to.r, mv.to.c, {
            fromRemote: true,
            promotion: mv.promotion || 'queen'
          });
        }
      }
    }
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
    audioEl.srcObject = stream;
    audioEl.play().catch((err) => console.warn('Remote audio autoplay waiting for user gesture:', err));
  }
}

export const onlineManager = new OnlineManager();
