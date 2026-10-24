import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

export interface Move {
  seq: number;
  color: 'w' | 'b';
  from: { r: number; c: number };
  to: { r: number; c: number };
  promotion?: string;
  san?: string;
  ts: number;
  whiteTimeRemaining?: number;
  blackTimeRemaining?: number;
}

export interface PlayerInfo {
  token: string;
  name: string;
  connected: boolean;
  color: 'w' | 'b' | 'spectator';
  lastSeen: number;
}

export interface ChatMessage {
  id: string;
  sender: 'w' | 'b' | 'spectator' | 'system';
  senderName: string;
  text: string;
  ts: number;
  isEmote?: boolean;
}

export interface RoomData {
  code: string;
  name: string;
  password?: string;
  isQuickMatch?: boolean;
  status: 'waiting' | 'playing' | 'ended';
  timeControl: 'none' | '3m' | '5m' | '10m';
  whiteTimeRemaining: number;
  blackTimeRemaining: number;
  lastTurnSwitchTs: number;
  white: PlayerInfo | null;
  black: PlayerInfo | null;
  spectators: PlayerInfo[];
  turn: 'w' | 'b';
  moves: Move[];
  resetCount: number;
  chat: ChatMessage[];
  drawOffer: 'w' | 'b' | null;
  rematchOffers: string[];
  winner: 'w' | 'b' | 'draw' | null;
  winReason: string | null;
  createdAt: number;
  updatedAt: number;
}

const rooms = new Map<string, RoomData>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketMetadata = new Map<
  WebSocket,
  { roomCode: string; playerToken: string; playerName: string; role: 'w' | 'b' | 'spectator' }
>();

function getTimeLimitSeconds(tc: string): number {
  if (tc === '3m') return 180;
  if (tc === '5m') return 300;
  if (tc === '10m') return 600;
  return 0; // 'none'
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sanitizeRoomSummary(room: RoomData) {
  return {
    code: room.code,
    name: room.name,
    hasPassword: Boolean(room.password),
    isQuickMatch: Boolean(room.isQuickMatch),
    status: room.status,
    timeControl: room.timeControl,
    whiteTimeRemaining: room.whiteTimeRemaining,
    blackTimeRemaining: room.blackTimeRemaining,
    whiteJoined: Boolean(room.white),
    blackJoined: Boolean(room.black),
    whiteName: room.white?.name || 'Waiting...',
    blackName: room.black?.name || 'Waiting...',
    whiteConnected: Boolean(room.white?.connected),
    blackConnected: Boolean(room.black?.connected),
    turn: room.turn,
    movesCount: room.moves.length,
    spectatorsCount: room.spectators.length,
    resetCount: room.resetCount,
    drawOffer: room.drawOffer,
    rematchOffersCount: room.rematchOffers.length,
    winner: room.winner,
    winReason: room.winReason,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function broadcastToRoom(roomCode: string, payload: any, senderWs?: WebSocket) {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const msg = JSON.stringify(payload);
  for (const client of sockets) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastToRoomAll(roomCode: string, payload: any) {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const msg = JSON.stringify(payload);
  for (const client of sockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// 1-second server tick for active game clocks
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.status === 'playing' && room.timeControl !== 'none') {
      const activeColor = room.turn;
      if (activeColor === 'w') {
        room.whiteTimeRemaining = Math.max(0, room.whiteTimeRemaining - 1);
        if (room.whiteTimeRemaining === 0) {
          room.status = 'ended';
          room.winner = 'b';
          room.winReason = 'White ran out of time';
          room.updatedAt = now;
          broadcastToRoomAll(code, {
            type: 'game_over',
            roomCode: code,
            winner: 'b',
            reason: 'time_out',
            message: 'Black wins on time!',
            room
          });
        }
      } else {
        room.blackTimeRemaining = Math.max(0, room.blackTimeRemaining - 1);
        if (room.blackTimeRemaining === 0) {
          room.status = 'ended';
          room.winner = 'w';
          room.winReason = 'Black ran out of time';
          room.updatedAt = now;
          broadcastToRoomAll(code, {
            type: 'game_over',
            roomCode: code,
            winner: 'w',
            reason: 'time_out',
            message: 'White wins on time!',
            room
          });
        }
      }

      // Sync clocks periodically (every 5 seconds or when low on time)
      if (
        room.status === 'playing' &&
        (now % 5000 < 1000 || room.whiteTimeRemaining <= 30 || room.blackTimeRemaining <= 30)
      ) {
        broadcastToRoomAll(code, {
          type: 'clock_sync',
          roomCode: code,
          whiteTime: room.whiteTimeRemaining,
          blackTime: room.blackTimeRemaining,
          turn: room.turn
        });
      }
    }
  }
}, 1000);

// Enhanced room cleanup function
function cleanupStaleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const sockets = roomSockets.get(code);
    const hasSockets = Boolean(sockets && sockets.size > 0);
    const isHostConnected = Boolean(
      (room.white && room.white.connected) || (room.black && room.black.connected)
    );

    // 1. Waiting rooms: prune if empty for > 30s or abandoned quick match > 3m
    if (room.status === 'waiting') {
      if (!hasSockets && (now - room.updatedAt > 30000 || !isHostConnected)) {
        rooms.delete(code);
        roomSockets.delete(code);
        continue;
      }
      if (room.isQuickMatch && now - room.createdAt > 3 * 60 * 1000 && !hasSockets) {
        rooms.delete(code);
        roomSockets.delete(code);
        continue;
      }
      if (now - room.createdAt > 30 * 60 * 1000) {
        rooms.delete(code);
        roomSockets.delete(code);
        continue;
      }
    }

    // 2. Ended matches: prune if empty or older than 5 minutes
    if (room.status === 'ended') {
      if (!hasSockets || now - room.updatedAt > 5 * 60 * 1000) {
        rooms.delete(code);
        roomSockets.delete(code);
        continue;
      }
    }

    // 3. Any abandoned room with 0 sockets for over 2 minutes
    if (!hasSockets && now - room.updatedAt > 2 * 60 * 1000) {
      rooms.delete(code);
      roomSockets.delete(code);
      continue;
    }
  }
}

// Cleanup stale empty rooms every 15 seconds
setInterval(cleanupStaleRooms, 15000);

// =========================================================================
// REST Endpoints
// =========================================================================

app.get('/api/health', (_req: Request, res: Response) => {
  let totalActivePlayers = 0;
  for (const sockets of roomSockets.values()) {
    totalActivePlayers += sockets.size;
  }
  res.json({
    ok: true,
    activeRooms: rooms.size,
    activePlayers: totalActivePlayers,
    timestamp: Date.now()
  });
});

app.get('/api/matchmaking/stats', (_req: Request, res: Response) => {
  cleanupStaleRooms();
  let waitingCount = 0;
  let playingCount = 0;
  for (const r of rooms.values()) {
    if (r.status === 'waiting' && !r.password) waitingCount++;
    if (r.status === 'playing') playingCount++;
  }
  res.json({
    ok: true,
    waitingCount,
    playingCount,
    totalRooms: rooms.size
  });
});

// List public rooms waiting for players (prunes dead rooms, excludes quick match & private)
app.get('/api/rooms', (_req: Request, res: Response) => {
  cleanupStaleRooms();
  const publicRooms: any[] = [];
  for (const room of rooms.values()) {
    const isHostActive = (room.white && room.white.connected) || (room.black && room.black.connected);
    if (room.status === 'waiting' && isHostActive) {
      publicRooms.push(sanitizeRoomSummary(room));
    }
  }
  res.json({ ok: true, rooms: publicRooms.slice(0, 25) });
});

// Create Room (supports optional password)
app.post('/api/rooms/create', (req: Request, res: Response) => {
  const {
    preferredColor = 'w',
    playerToken = 'tok_' + Math.random().toString(36).slice(2, 12),
    playerName = 'Archmage ' + Math.floor(100 + Math.random() * 900),
    timeControl = 'none',
    roomName = '',
    password = ''
  } = req.body || {};

  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const assignedColor: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
  const timeLimit = getTimeLimitSeconds(timeControl);
  const cleanPassword = password ? String(password).trim().slice(0, 16) : undefined;

  const playerObj: PlayerInfo = {
    token: playerToken,
    name: String(playerName || 'Wizard').slice(0, 24),
    connected: false,
    color: assignedColor,
    lastSeen: Date.now()
  };

  const newRoom: RoomData = {
    code,
    name: roomName || `Sanctum ${code}`,
    password: cleanPassword,
    status: 'waiting',
    timeControl: ['3m', '5m', '10m'].includes(timeControl) ? timeControl : 'none',
    whiteTimeRemaining: timeLimit,
    blackTimeRemaining: timeLimit,
    lastTurnSwitchTs: Date.now(),
    white: assignedColor === 'w' ? playerObj : null,
    black: assignedColor === 'b' ? playerObj : null,
    spectators: [],
    turn: 'w',
    moves: [],
    resetCount: 0,
    chat: [
      {
        id: 'msg_' + Date.now(),
        sender: 'system',
        senderName: 'Sanctum',
        text: `Room ${code} created.${cleanPassword ? ' [Password Protected]' : ''} Waiting for opponent...`,
        ts: Date.now()
      }
    ],
    drawOffer: null,
    rematchOffers: [],
    winner: null,
    winReason: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  rooms.set(code, newRoom);

  res.json({
    ok: true,
    code,
    color: assignedColor,
    role: assignedColor,
    playerToken,
    hasPassword: Boolean(cleanPassword),
    room: newRoom
  });
});

// Join Room Handler with Password Verification
function handleJoinRoom(req: Request, res: Response) {
  const code = String(req.params.code || req.body?.code || '').trim().toUpperCase();
  const {
    playerToken = 'tok_' + Math.random().toString(36).slice(2, 12),
    playerName = 'Sorcerer ' + Math.floor(100 + Math.random() * 900),
    password = '',
    createIfMissing = false
  } = req.body || {};

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Room code is required' });
  }

  let room = rooms.get(code);
  let assignedRole: 'w' | 'b' | 'spectator' = 'w';

  if (!room) {
    if (!createIfMissing) {
      return res.status(404).json({ ok: false, error: `Sanctum room ${code} not found or has expired` });
    }
    // Auto-create room only when explicitly permitted
    const newPlayer: PlayerInfo = {
      token: playerToken,
      name: String(playerName || 'Player 1').slice(0, 24),
      connected: false,
      color: 'w',
      lastSeen: Date.now()
    };
    room = {
      code,
      name: `Sanctum ${code}`,
      status: 'waiting',
      timeControl: 'none',
      whiteTimeRemaining: 0,
      blackTimeRemaining: 0,
      lastTurnSwitchTs: Date.now(),
      white: newPlayer,
      black: null,
      spectators: [],
      turn: 'w',
      moves: [],
      resetCount: 0,
      chat: [
        {
          id: 'msg_' + Date.now(),
          sender: 'system',
          senderName: 'Sanctum',
          text: `Room ${code} created.`,
          ts: Date.now()
        }
      ],
      drawOffer: null,
      rematchOffers: [],
      winner: null,
      winReason: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    rooms.set(code, room);
    assignedRole = 'w';
  } else {
    // Check password if room is protected
    if (room.password) {
      const provided = String(password || '').trim();
      const isReturningPlayer =
        (room.white && room.white.token === playerToken) ||
        (room.black && room.black.token === playerToken);
      if (!isReturningPlayer && (!provided || provided !== room.password)) {
        return res.status(403).json({
          ok: false,
          error: provided ? 'Incorrect room password' : 'Room password required',
          requirePassword: true
        });
      }
    }

    // Room exists: identify returning player or assign free color or spectator
    if (room.white && room.white.token === playerToken) {
      assignedRole = 'w';
      room.white.connected = true;
      room.white.name = playerName || room.white.name;
    } else if (room.black && room.black.token === playerToken) {
      assignedRole = 'b';
      room.black.connected = true;
      room.black.name = playerName || room.black.name;
    } else if (!room.white) {
      assignedRole = 'w';
      room.white = {
        token: playerToken,
        name: String(playerName || 'White Mage').slice(0, 24),
        connected: true,
        color: 'w',
        lastSeen: Date.now()
      };
    } else if (!room.black) {
      assignedRole = 'b';
      room.black = {
        token: playerToken,
        name: String(playerName || 'Black Mage').slice(0, 24),
        connected: true,
        color: 'b',
        lastSeen: Date.now()
      };
    } else {
      // Both seats occupied: join as spectator
      assignedRole = 'spectator';
      const existingSpec = room.spectators.find((s) => s.token === playerToken);
      if (!existingSpec) {
        room.spectators.push({
          token: playerToken,
          name: String(playerName || 'Spectator').slice(0, 24),
          connected: true,
          color: 'spectator',
          lastSeen: Date.now()
        });
      }
    }

    if (room.white && room.black && room.status === 'waiting') {
      room.status = 'playing';
      room.lastTurnSwitchTs = Date.now();
      room.chat.push({
        id: 'msg_' + Date.now(),
        sender: 'system',
        senderName: 'Sanctum',
        text: `Both duelists connected! The wizard chess match begins!`,
        ts: Date.now()
      });
    }

    room.updatedAt = Date.now();
    broadcastToRoomAll(code, {
      type: 'room_state',
      room
    });
  }

  res.json({
    ok: true,
    code,
    color: assignedRole === 'spectator' ? 'w' : assignedRole,
    role: assignedRole,
    playerToken,
    room
  });
}

app.post('/api/rooms/:code/join', handleJoinRoom);
app.post('/api/rooms/join', handleJoinRoom);

// Get Room State
app.get('/api/rooms/:code/state', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }
  res.json({ ok: true, room });
});

// Submit Move (HTTP fallback)
app.post('/api/rooms/:code/move', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }

  const { color, from, to, promotion = 'queen', san = '' } = req.body || {};
  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'Invalid move coordinates' });
  }

  const moveColor = color === 'b' ? 'b' : 'w';
  const now = Date.now();

  const move: Move = {
    seq: room.moves.length + 1,
    color: moveColor,
    from,
    to,
    promotion,
    san,
    ts: now,
    whiteTimeRemaining: room.whiteTimeRemaining,
    blackTimeRemaining: room.blackTimeRemaining
  };

  room.moves.push(move);
  room.turn = moveColor === 'w' ? 'b' : 'w';
  room.lastTurnSwitchTs = now;
  room.drawOffer = null; // moving cancels draw offer
  room.updatedAt = now;

  broadcastToRoomAll(code, {
    type: 'move',
    roomCode: code,
    move,
    room
  });

  res.json({ ok: true, move, room });
});

// Reset Game (HTTP fallback)
app.post('/api/rooms/:code/reset', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }

  const timeLimit = getTimeLimitSeconds(room.timeControl);
  room.moves = [];
  room.turn = 'w';
  room.whiteTimeRemaining = timeLimit;
  room.blackTimeRemaining = timeLimit;
  room.lastTurnSwitchTs = Date.now();
  room.resetCount = (room.resetCount || 0) + 1;
  room.status = room.white && room.black ? 'playing' : 'waiting';
  room.winner = null;
  room.winReason = null;
  room.drawOffer = null;
  room.rematchOffers = [];
  room.updatedAt = Date.now();

  broadcastToRoomAll(code, {
    type: 'reset',
    roomCode: code,
    resetCount: room.resetCount,
    room
  });

  res.json({ ok: true, room });
});

app.post('/api/rooms/:code/resign', (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const { playerToken } = req.body || {};
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }

  let resignedRole: 'w' | 'b' | null = null;
  let playerName = 'Player';
  if (playerToken && room.white?.token === playerToken) {
    resignedRole = 'w';
    playerName = room.white?.name || 'White';
  } else if (playerToken && room.black?.token === playerToken) {
    resignedRole = 'b';
    playerName = room.black?.name || 'Black';
  } else if (req.body?.role === 'w' || req.body?.role === 'b') {
    resignedRole = req.body.role;
    playerName = resignedRole === 'w' ? (room.white?.name || 'White') : (room.black?.name || 'Black');
  }

  if (resignedRole) {
    room.status = 'ended';
    room.winner = resignedRole === 'w' ? 'b' : 'w';
    room.winReason = `${playerName} resigned`;
    room.updatedAt = Date.now();

    broadcastToRoomAll(code, {
      type: 'game_over',
      roomCode: code,
      winner: room.winner,
      reason: 'resignation',
      resignedBy: resignedRole,
      message: `${playerName} (${resignedRole === 'w' ? 'White' : 'Black'}) resigned.`,
      room
    });
  }

  res.json({ ok: true, room });
});

// Leave Room HTTP Endpoint for explicit departure & instant cleanup
app.post('/api/rooms/:code/leave', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const { playerToken } = req.body || {};
  const room = rooms.get(code);
  if (!room) {
    return res.json({ ok: true, message: 'Room already gone' });
  }

  let leavingRole: 'w' | 'b' | 'spectator' = 'spectator';
  let playerName = 'A duelist';

  if (playerToken && room.white && room.white.token === playerToken) {
    leavingRole = 'w';
    playerName = room.white.name;
    room.white.connected = false;
  } else if (playerToken && room.black && room.black.token === playerToken) {
    leavingRole = 'b';
    playerName = room.black.name;
    room.black.connected = false;
  } else {
    room.spectators = room.spectators.filter((s) => s.token !== playerToken);
  }

  room.updatedAt = Date.now();

  const sockets = roomSockets.get(code);
  broadcastToRoom(code, {
    type: 'peer_left',
    color: leavingRole,
    playerName,
    room,
    totalInRoom: sockets?.size || 0
  });

  // If match was in progress, declare game over
  if (room.status === 'playing') {
    room.status = 'ended';
    room.winner = leavingRole === 'w' ? 'b' : 'w';
    room.winReason = `${playerName} left the match`;
  }

  // If no players remain or room is a waiting room, clean up immediately
  const hasRemainingPlayer = Boolean(
    (room.white && room.white.connected) || (room.black && room.black.connected)
  );
  if (!hasRemainingPlayer || room.status === 'waiting' || (sockets && sockets.size === 0)) {
    rooms.delete(code);
    roomSockets.delete(code);
  }

  res.json({ ok: true, message: 'Left room successfully' });
});

// =========================================================================
// Real-Time WebSocket Server
// =========================================================================

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data.toString());
      const { type, roomCode } = msg;

      if (type === 'quick_match') {
        // Find an open room or create one immediately
        const {
          playerToken = 'tok_' + Math.random().toString(36).slice(2, 12),
          playerName = 'Duelist ' + Math.floor(100 + Math.random() * 900),
          timeControl = 'none',
          preferredColor = 'random'
        } = msg;

        let matchedRoom: RoomData | null = null;
        for (const r of rooms.values()) {
          // Never match into password-protected rooms
          if (r.password) continue;
          if (r.status === 'waiting') {
            const tcMatch = timeControl === 'any' || r.timeControl === timeControl;
            if (tcMatch) {
              const hostConnected = Boolean(
                (r.white && r.white.connected) || (r.black && r.black.connected)
              );
              if (
                hostConnected &&
                (!r.white || !r.black) &&
                r.white?.token !== playerToken &&
                r.black?.token !== playerToken
              ) {
                matchedRoom = r;
                break;
              }
            }
          }
        }

        let assignedColor: 'w' | 'b' = 'w';
        if (matchedRoom) {
          // Join matched room
          assignedColor = !matchedRoom.white ? 'w' : 'b';
          const pObj: PlayerInfo = {
            token: playerToken,
            name: playerName,
            connected: true,
            color: assignedColor,
            lastSeen: Date.now()
          };
          if (assignedColor === 'w') matchedRoom.white = pObj;
          else matchedRoom.black = pObj;

          matchedRoom.status = 'playing';
          matchedRoom.lastTurnSwitchTs = Date.now();
          matchedRoom.updatedAt = Date.now();

          let sockets = roomSockets.get(matchedRoom.code);
          if (!sockets) {
            sockets = new Set();
            roomSockets.set(matchedRoom.code, sockets);
          }
          sockets.add(ws);

          socketMetadata.set(ws, {
            roomCode: matchedRoom.code,
            playerToken,
            playerName,
            role: assignedColor
          });

          ws.send(
            JSON.stringify({
              type: 'joined',
              room: matchedRoom,
              color: assignedColor,
              role: assignedColor
            })
          );

          broadcastToRoomAll(matchedRoom.code, {
            type: 'peer_joined',
            color: assignedColor,
            room: matchedRoom,
            totalInRoom: sockets.size
          });
        } else {
          // Create new waiting room
          let code = generateRoomCode();
          while (rooms.has(code)) {
            code = generateRoomCode();
          }

          if (preferredColor === 'b') assignedColor = 'b';
          else if (preferredColor === 'random') assignedColor = Math.random() > 0.5 ? 'w' : 'b';
          else assignedColor = 'w';

          const timeLimit = getTimeLimitSeconds(timeControl === 'any' ? 'none' : timeControl);
          const pObj: PlayerInfo = {
            token: playerToken,
            name: playerName,
            connected: true,
            color: assignedColor,
            lastSeen: Date.now()
          };

          const newRoom: RoomData = {
            code,
            name: `Match ${code}`,
            isQuickMatch: true,
            status: 'waiting',
            timeControl: ['3m', '5m', '10m'].includes(timeControl) ? timeControl : 'none',
            whiteTimeRemaining: timeLimit,
            blackTimeRemaining: timeLimit,
            lastTurnSwitchTs: Date.now(),
            white: assignedColor === 'w' ? pObj : null,
            black: assignedColor === 'b' ? pObj : null,
            spectators: [],
            turn: 'w',
            moves: [],
            resetCount: 0,
            chat: [
              {
                id: 'msg_' + Date.now(),
                sender: 'system',
                senderName: 'Sanctum',
                text: `Searching for opponent in ${timeControl === 'none' ? 'Unlimited' : timeControl} match...`,
                ts: Date.now()
              }
            ],
            drawOffer: null,
            rematchOffers: [],
            winner: null,
            winReason: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };

          rooms.set(code, newRoom);

          let sockets = roomSockets.get(code);
          if (!sockets) {
            sockets = new Set();
            roomSockets.set(code, sockets);
          }
          sockets.add(ws);

          socketMetadata.set(ws, {
            roomCode: code,
            playerToken,
            playerName,
            role: assignedColor
          });

          ws.send(
            JSON.stringify({
              type: 'joined',
              room: newRoom,
              color: assignedColor,
              role: assignedColor
            })
          );
        }
      } else if (type === 'join') {
        const code = String(roomCode || '').trim().toUpperCase();
        let sockets = roomSockets.get(code);
        if (!sockets) {
          sockets = new Set();
          roomSockets.set(code, sockets);
        }
        sockets.add(ws);

        let room = rooms.get(code);
        const {
          playerToken = 'tok_' + Math.random().toString(36).slice(2, 12),
          playerName = 'Mage ' + Math.floor(100 + Math.random() * 900),
          preferredColor = 'w',
          timeControl = 'none',
          password = '',
          createIfMissing = false
        } = msg;

        let role: 'w' | 'b' | 'spectator' = 'w';

        if (!room) {
          if (!createIfMissing) {
            ws.send(
              JSON.stringify({
                type: 'error',
                error: `Sanctum room ${code} not found or expired`
              })
            );
            return;
          }
          const timeLimit = getTimeLimitSeconds(timeControl);
          const color = preferredColor === 'b' ? 'b' : 'w';
          role = color;
          const playerObj: PlayerInfo = {
            token: playerToken,
            name: playerName,
            connected: true,
            color,
            lastSeen: Date.now()
          };
          room = {
            code,
            name: `Sanctum ${code}`,
            status: 'waiting',
            timeControl: ['3m', '5m', '10m'].includes(timeControl) ? timeControl : 'none',
            whiteTimeRemaining: timeLimit,
            blackTimeRemaining: timeLimit,
            lastTurnSwitchTs: Date.now(),
            white: color === 'w' ? playerObj : null,
            black: color === 'b' ? playerObj : null,
            spectators: [],
            turn: 'w',
            moves: [],
            resetCount: 0,
            chat: [
              {
                id: 'msg_' + Date.now(),
                sender: 'system',
                senderName: 'Sanctum',
                text: `Room ${code} created.`,
                ts: Date.now()
              }
            ],
            drawOffer: null,
            rematchOffers: [],
            winner: null,
            winReason: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          rooms.set(code, room);
        } else {
          // Verify password if protected
          if (room.password) {
            const provided = String(password || '').trim();
            const isReturningPlayer =
              (room.white && room.white.token === playerToken) ||
              (room.black && room.black.token === playerToken);
            if (!isReturningPlayer && (!provided || provided !== room.password)) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: provided ? 'Incorrect room password' : 'Room password required',
                  requirePassword: true
                })
              );
              return;
            }
          }

          // Identify user
          if (room.white && room.white.token === playerToken) {
            role = 'w';
            room.white.connected = true;
            room.white.name = playerName || room.white.name;
          } else if (room.black && room.black.token === playerToken) {
            role = 'b';
            room.black.connected = true;
            room.black.name = playerName || room.black.name;
          } else if (!room.white) {
            role = 'w';
            room.white = {
              token: playerToken,
              name: playerName,
              connected: true,
              color: 'w',
              lastSeen: Date.now()
            };
          } else if (!room.black) {
            role = 'b';
            room.black = {
              token: playerToken,
              name: playerName,
              connected: true,
              color: 'b',
              lastSeen: Date.now()
            };
          } else {
            role = 'spectator';
            const spec = room.spectators.find((s) => s.token === playerToken);
            if (spec) {
              spec.connected = true;
              spec.name = playerName || spec.name;
            } else {
              room.spectators.push({
                token: playerToken,
                name: playerName,
                connected: true,
                color: 'spectator',
                lastSeen: Date.now()
              });
            }
          }

          if (room.white && room.black && room.status === 'waiting') {
            room.status = 'playing';
            room.lastTurnSwitchTs = Date.now();
            room.chat.push({
              id: 'msg_' + Date.now(),
              sender: 'system',
              senderName: 'Sanctum',
              text: `Both duelists connected! White moves first.`,
              ts: Date.now()
            });
          }
          room.updatedAt = Date.now();
        }

        socketMetadata.set(ws, {
          roomCode: code,
          playerToken,
          playerName,
          role
        });

        ws.send(
          JSON.stringify({
            type: 'joined',
            room,
            color: role === 'spectator' ? 'w' : role,
            role
          })
        );

        broadcastToRoom(
          code,
          {
            type: 'peer_joined',
            color: role,
            playerName,
            room,
            totalInRoom: sockets.size
          },
          ws
        );
      } else if (type === 'move') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);

        if (room && msg.move) {
          const moveColor = msg.move.color === 'b' ? 'b' : 'w';

          // Validate turn ownership
          if (meta && meta.role !== 'spectator' && meta.role !== moveColor) {
            console.warn(`Unauthorized move attempt by ${meta.role} for color ${moveColor}`);
            return;
          }

          const now = Date.now();
          const move: Move = {
            seq: room.moves.length + 1,
            color: moveColor,
            from: msg.move.from,
            to: msg.move.to,
            promotion: msg.move.promotion || 'queen',
            san: msg.move.san || '',
            ts: now,
            whiteTimeRemaining: room.whiteTimeRemaining,
            blackTimeRemaining: room.blackTimeRemaining
          };

          room.moves.push(move);
          room.turn = moveColor === 'w' ? 'b' : 'w';
          room.lastTurnSwitchTs = now;
          room.drawOffer = null;
          room.updatedAt = now;

          broadcastToRoomAll(code, {
            type: 'move',
            roomCode: code,
            move,
            room
          });
        }
      } else if (type === 'chat') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        if (room && msg.text) {
          const chatMsg: ChatMessage = {
            id: 'msg_' + Date.now() + Math.random().toString(36).slice(2, 6),
            sender: meta?.role || 'spectator',
            senderName: meta?.playerName || 'Duelist',
            text: String(msg.text).slice(0, 140),
            isEmote: Boolean(msg.isEmote),
            ts: Date.now()
          };
          room.chat.push(chatMsg);
          if (room.chat.length > 80) room.chat.shift();
          room.updatedAt = Date.now();

          broadcastToRoomAll(code, {
            type: 'chat',
            roomCode: code,
            message: chatMsg
          });
        }
      } else if (type === 'resign') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        if (room && meta && (meta.role === 'w' || meta.role === 'b')) {
          room.status = 'ended';
          room.winner = meta.role === 'w' ? 'b' : 'w';
          room.winReason = `${meta.playerName} resigned`;
          room.updatedAt = Date.now();

          broadcastToRoomAll(code, {
            type: 'game_over',
            roomCode: code,
            winner: room.winner,
            reason: 'resignation',
            resignedBy: meta.role,
            message: `${meta.playerName} (${meta.role === 'w' ? 'White' : 'Black'}) resigned.`,
            room
          });
        }
      } else if (type === 'draw_offer') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        if (room && meta && (meta.role === 'w' || meta.role === 'b')) {
          room.drawOffer = meta.role;
          broadcastToRoom(
            code,
            {
              type: 'draw_offered',
              by: meta.role,
              playerName: meta.playerName
            },
            ws
          );
        }
      } else if (type === 'draw_response') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        if (room && meta) {
          if (msg.accept && room.drawOffer && room.drawOffer !== meta.role) {
            room.status = 'ended';
            room.winner = 'draw';
            room.winReason = 'Mutual draw agreed';
            room.drawOffer = null;
            room.updatedAt = Date.now();

            broadcastToRoomAll(code, {
              type: 'game_over',
              roomCode: code,
              winner: 'draw',
              reason: 'draw_agreement',
              message: 'Draw agreed by both duelists.',
              room
            });
          } else {
            room.drawOffer = null;
            broadcastToRoomAll(code, {
              type: 'draw_declined',
              by: meta.role
            });
          }
        }
      } else if (type === 'rematch_request') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        if (room && meta) {
          if (!room.rematchOffers.includes(meta.playerToken)) {
            room.rematchOffers.push(meta.playerToken);
          }

          // Check if both White & Black voted for rematch
          const whiteWants = room.white && room.rematchOffers.includes(room.white.token);
          const blackWants = room.black && room.rematchOffers.includes(room.black.token);

          if (whiteWants && blackWants) {
            // Swap colors for rematch
            const temp = room.white;
            room.white = room.black;
            room.black = temp;
            if (room.white) room.white.color = 'w';
            if (room.black) room.black.color = 'b';

            const timeLimit = getTimeLimitSeconds(room.timeControl);
            room.moves = [];
            room.turn = 'w';
            room.whiteTimeRemaining = timeLimit;
            room.blackTimeRemaining = timeLimit;
            room.lastTurnSwitchTs = Date.now();
            room.resetCount = (room.resetCount || 0) + 1;
            room.status = 'playing';
            room.winner = null;
            room.winReason = null;
            room.drawOffer = null;
            room.rematchOffers = [];
            room.updatedAt = Date.now();

            // Update socket metadata with swapped colors
            for (const [sock, sMeta] of socketMetadata.entries()) {
              if (sMeta.roomCode === code) {
                if (room.white && sMeta.playerToken === room.white.token) sMeta.role = 'w';
                if (room.black && sMeta.playerToken === room.black.token) sMeta.role = 'b';
              }
            }

            broadcastToRoomAll(code, {
              type: 'rematch_started',
              roomCode: code,
              room
            });
          } else {
            broadcastToRoomAll(code, {
              type: 'rematch_requested',
              by: meta.role,
              playerName: meta.playerName
            });
          }
        }
      } else if (type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', clientTs: msg.clientTs, serverTs: Date.now() }));
      } else if (
        type === 'voice_offer' ||
        type === 'voice_answer' ||
        type === 'voice_ice' ||
        type === 'voice_status'
      ) {
        // Relay WebRTC audio signaling to opponent
        const code = String(roomCode || '').trim().toUpperCase();
        broadcastToRoom(code, msg, ws);
      } else if (type === 'reset') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (room) {
          const timeLimit = getTimeLimitSeconds(room.timeControl);
          room.moves = [];
          room.turn = 'w';
          room.whiteTimeRemaining = timeLimit;
          room.blackTimeRemaining = timeLimit;
          room.lastTurnSwitchTs = Date.now();
          room.resetCount = (room.resetCount || 0) + 1;
          room.winner = null;
          room.winReason = null;
          room.drawOffer = null;
          room.rematchOffers = [];
          room.updatedAt = Date.now();
          broadcastToRoomAll(code, {
            type: 'reset',
            roomCode: code,
            resetCount: room.resetCount,
            room
          });
        }
      } else if (type === 'leave_room') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        const meta = socketMetadata.get(ws);
        const sockets = roomSockets.get(code);
        if (sockets) {
          sockets.delete(ws);
        }
        if (room && meta) {
          if (room.white && room.white.token === meta.playerToken) {
            room.white.connected = false;
          }
          if (room.black && room.black.token === meta.playerToken) {
            room.black.connected = false;
          }
          room.spectators = room.spectators.filter((s) => s.token !== meta.playerToken);
          room.updatedAt = Date.now();

          if (room.status === 'playing') {
            room.status = 'ended';
            room.winner = meta.role === 'w' ? 'b' : 'w';
            room.winReason = `${meta.playerName} left the match`;
          }

          broadcastToRoom(code, {
            type: 'peer_left',
            color: meta.role,
            playerName: meta.playerName,
            room,
            totalInRoom: sockets?.size || 0
          });

          // Immediate cleanup if no players are left or if room was waiting
          const hasRemainingPlayer = Boolean(
            (room.white && room.white.connected) || (room.black && room.black.connected)
          );
          if (!hasRemainingPlayer || room.status === 'waiting' || (sockets && sockets.size === 0)) {
            rooms.delete(code);
            roomSockets.delete(code);
          }
        }
        socketMetadata.delete(ws);
        ws.send(JSON.stringify({ type: 'left_room', roomCode: code }));
      }
    } catch (err) {
      console.warn('WS message parse error:', err);
    }
  });

  ws.on('close', () => {
    const meta = socketMetadata.get(ws);
    if (meta) {
      const { roomCode, playerToken, role, playerName } = meta;
      const sockets = roomSockets.get(roomCode);
      if (sockets) {
        sockets.delete(ws);
        const room = rooms.get(roomCode);
        if (room) {
          if (room.white && room.white.token === playerToken) {
            room.white.connected = false;
          }
          if (room.black && room.black.token === playerToken) {
            room.black.connected = false;
          }
          room.spectators = room.spectators.filter((s) => s.token !== playerToken);
          room.updatedAt = Date.now();

          broadcastToRoom(roomCode, {
            type: 'peer_left',
            color: role,
            playerName,
            room,
            totalInRoom: sockets.size
          });

          // Immediate cleanup if no players remain or waiting room abandoned
          const hasRemainingPlayer = Boolean(
            (room.white && room.white.connected) || (room.black && room.black.connected)
          );
          if (sockets.size === 0 || room.status === 'waiting' || !hasRemainingPlayer) {
            rooms.delete(roomCode);
            roomSockets.delete(roomCode);
          }
        }
      }
      socketMetadata.delete(ws);
    }
  });
});

// Setup Vite middleware in dev or static serving in prod
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: HOST, port: PORT },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Wizard Chess fullstack server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
