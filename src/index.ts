import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { authRouter } from './routes/auth';
import { conversationsRouter } from './routes/conversations';
import { mediaRouter } from './routes/media';
import { setupSocket } from './socket';
import { initDB } from './db';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'PrivateSnap API' });
});

// Rutas
app.use('/auth', authRouter);
app.use('/conversations', conversationsRouter);
app.use('/media', mediaRouter);
app.use(express.json({ limit: '100mb' })); // Para archivos grandes

// Socket.io
setupSocket(io);

const PORT = process.env.PORT || 3001;

async function start() {
  await initDB();
  httpServer.listen(PORT, () => {
    console.log(`✅ PrivateSnap server running on port ${PORT}`);
  });
}

start();
