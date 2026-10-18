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
app.use(express.json());

interface Move {
  seq: number;
  color: 'w' | 'b';
  from: { r: number; c: number };
  to: { r: number; c: number };
  promotion?: string;
  ts: number;
}

interface RoomData {
  code: string;
  status: 'waiting' | 'playing' | 'ended';
  whiteJoined: boolean;
  blackJoined: boolean;
  whiteToken: string | null;
  blackToken: string | null;
  turn: 'w' | 'b';
  moves: Move[];
  resetCount: number;
  updatedAt: number;
}

const rooms = new Map<string, RoomData>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketMetadata = new Map<WebSocket, { roomCode: string; playerToken: string; color: 'w' | 'b' | 'spectator' }>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

// REST Endpoints
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, activeRooms: rooms.size, timestamp: Date.now() });
});

app.post('/api/rooms/create', (req: Request, res: Response) => {
  const { preferredColor = 'w', playerToken = 'tok_' + Math.random().toString(36).slice(2, 12) } = req.body || {};
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const assignedColor: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
  const newRoom: RoomData = {
    code,
    status: 'waiting',
    whiteJoined: assignedColor === 'w',
    blackJoined: assignedColor === 'b',
    whiteToken: assignedColor === 'w' ? playerToken : null,
    blackToken: assignedColor === 'b' ? playerToken : null,
    turn: 'w',
    moves: [],
    resetCount: 0,
    updatedAt: Date.now()
  };

  rooms.set(code, newRoom);
  res.json({
    ok: true,
    code,
    color: assignedColor,
    playerToken,
    room: newRoom
  });
});

app.post('/api/rooms/:code/join', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const { playerToken = 'tok_' + Math.random().toString(36).slice(2, 12) } = req.body || {};

  let room = rooms.get(code);
  if (!room) {
    // Auto-create room if not found
    room = {
      code,
      status: 'playing',
      whiteJoined: true,
      blackJoined: true,
      whiteToken: playerToken,
      blackToken: null,
      turn: 'w',
      moves: [],
      resetCount: 0,
      updatedAt: Date.now()
    };
    rooms.set(code, room);
    return res.json({
      ok: true,
      code,
      color: 'w',
      playerToken,
      room
    });
  }

  let assignedColor: 'w' | 'b' = 'w';
  if (room.whiteToken === playerToken) {
    assignedColor = 'w';
  } else if (room.blackToken === playerToken) {
    assignedColor = 'b';
  } else if (!room.whiteJoined) {
    room.whiteJoined = true;
    room.whiteToken = playerToken;
    assignedColor = 'w';
  } else if (!room.blackJoined) {
    room.blackJoined = true;
    room.blackToken = playerToken;
    assignedColor = 'b';
  } else {
    // Both sides claimed, check if rejoining with existing token or fallback
    assignedColor = 'b';
  }

  room.status = room.whiteJoined && room.blackJoined ? 'playing' : 'waiting';
  room.updatedAt = Date.now();

  broadcastToRoomAll(code, {
    type: 'room_state',
    room
  });

  res.json({
    ok: true,
    code,
    color: assignedColor,
    playerToken,
    room
  });
});

app.get('/api/rooms/:code/state', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }
  res.json({ ok: true, room });
});

app.post('/api/rooms/:code/move', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }

  const { color, from, to, promotion = 'queen' } = req.body || {};
  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'Invalid move coordinates' });
  }

  const move: Move = {
    seq: room.moves.length + 1,
    color: color === 'b' ? 'b' : 'w',
    from,
    to,
    promotion,
    ts: Date.now()
  };

  room.moves.push(move);
  room.turn = move.color === 'w' ? 'b' : 'w';
  room.updatedAt = Date.now();

  broadcastToRoomAll(code, {
    type: 'move',
    roomCode: code,
    move,
    room
  });

  res.json({ ok: true, move, room });
});

app.post('/api/rooms/:code/reset', (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Room not found' });
  }

  room.moves = [];
  room.turn = 'w';
  room.resetCount = (room.resetCount || 0) + 1;
  room.updatedAt = Date.now();

  broadcastToRoomAll(code, {
    type: 'reset',
    roomCode: code,
    resetCount: room.resetCount,
    room
  });

  res.json({ ok: true, room });
});

// Create HTTP and WebSocket Server
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data.toString());
      const { type, roomCode } = msg;

      if (type === 'join') {
        const code = String(roomCode || '').trim().toUpperCase();
        let sockets = roomSockets.get(code);
        if (!sockets) {
          sockets = new Set();
          roomSockets.set(code, sockets);
        }
        sockets.add(ws);

        let room = rooms.get(code);
        if (!room) {
          room = {
            code,
            status: 'waiting',
            whiteJoined: true,
            blackJoined: false,
            whiteToken: msg.playerToken || null,
            blackToken: null,
            turn: 'w',
            moves: [],
            resetCount: 0,
            updatedAt: Date.now()
          };
          rooms.set(code, room);
        }

        socketMetadata.set(ws, {
          roomCode: code,
          playerToken: msg.playerToken || '',
          color: msg.color || 'w'
        });

        // Send current room state back to user
        ws.send(JSON.stringify({ type: 'joined', room, color: msg.color || 'w' }));

        // Notify other peer in room
        broadcastToRoom(code, {
          type: 'peer_joined',
          color: msg.color || 'w',
          totalInRoom: sockets.size
        }, ws);

      } else if (type === 'move') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (room && msg.move) {
          const move: Move = {
            seq: room.moves.length + 1,
            color: msg.move.color === 'b' ? 'b' : 'w',
            from: msg.move.from,
            to: msg.move.to,
            promotion: msg.move.promotion || 'queen',
            ts: Date.now()
          };
          room.moves.push(move);
          room.turn = move.color === 'w' ? 'b' : 'w';
          room.updatedAt = Date.now();

          broadcastToRoomAll(code, {
            type: 'move',
            roomCode: code,
            move,
            room
          });
        }

      } else if (type === 'voice_offer' || type === 'voice_answer' || type === 'voice_ice' || type === 'voice_status') {
        // Relay WebRTC audio signaling to opponent
        const code = String(roomCode || '').trim().toUpperCase();
        broadcastToRoom(code, msg, ws);

      } else if (type === 'reset') {
        const code = String(roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (room) {
          room.moves = [];
          room.turn = 'w';
          room.resetCount = (room.resetCount || 0) + 1;
          room.updatedAt = Date.now();
          broadcastToRoomAll(code, {
            type: 'reset',
            roomCode: code,
            resetCount: room.resetCount,
            room
          });
        }
      }
    } catch (err) {
      console.warn('WS message parse error:', err);
    }
  });

  ws.on('close', () => {
    const meta = socketMetadata.get(ws);
    if (meta) {
      const { roomCode, color } = meta;
      const sockets = roomSockets.get(roomCode);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          roomSockets.delete(roomCode);
        } else {
          broadcastToRoom(roomCode, {
            type: 'peer_left',
            color,
            totalInRoom: sockets.size
          });
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
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Wizard Chess fullstack server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
