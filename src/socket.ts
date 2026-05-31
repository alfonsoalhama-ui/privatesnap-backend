import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { db } from './db';

// Mapa de userId -> socketId (para saber si alguien está online)
const onlineUsers = new Map<string, string>();

export function setupSocket(io: Server) {
  // Autenticación por token al conectar
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
      (socket as any).userId = payload.userId;
      (socket as any).username = payload.username;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    const username = (socket as any).username;

    onlineUsers.set(userId, socket.id);
    console.log(`✅ ${username} connected`);

    // Unirse a sala personal para recibir mensajes
    socket.join(`user:${userId}`);

    // Notificar a todos que este usuario está online
    socket.broadcast.emit('user_online', { userId, username });

    // Enviar al recién conectado quién está ya online
    const onlineList = Array.from(onlineUsers.keys()).filter(id => id !== userId);
    socket.emit('online_users', onlineList);

    // Enviar mensaje de texto
    socket.on('send_message', async (data: {
      conversationId: string;
      content: string;
      type?: string;
      mediaId?: string;
      securityLevel?: number;
    }) => {
      try {
        // Guardar en base de datos
        const result = await db.query(`
          INSERT INTO messages (conversation_id, sender_id, type, content, media_id, security_level)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [
          data.conversationId,
          userId,
          data.type || 'text',
          data.content || null,
          data.mediaId || null,
          data.securityLevel || 1,
        ]);

        const message = result.rows[0];

        // Obtener el otro participante de la conversación
        const convResult = await db.query(
          'SELECT user1_id, user2_id FROM conversations WHERE id = $1',
          [data.conversationId]
        );
        const conv = convResult.rows[0];
        const recipientId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;

        // Enviar al receptor si está conectado
        io.to(`user:${recipientId}`).emit('new_message', {
          ...message,
          conversationId: data.conversationId,
          sender_username: username,
        });

        // Confirmar al emisor
        socket.emit('message_sent', message);
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Notificación de "está viendo tu vídeo ahora"
    socket.on('start_viewing', (data: { senderId: string; messageId: string }) => {
      io.to(`user:${data.senderId}`).emit('viewer_watching', {
        viewerId: userId,
        viewerUsername: username,
        messageId: data.messageId,
      });
    });

    socket.on('stop_viewing', (data: { senderId: string; messageId: string }) => {
      io.to(`user:${data.senderId}`).emit('viewer_stopped', {
        viewerId: userId,
        messageId: data.messageId,
      });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      console.log(`❌ ${username} disconnected`);
      socket.broadcast.emit('user_offline', { userId, username });
    });
  });
}
