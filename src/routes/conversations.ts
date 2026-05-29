import { Router } from 'express';
import { db } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// Obtener conversaciones del usuario
conversationsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await db.query(`
      SELECT c.id, c.created_at,
        u.id as other_id, u.username as other_username,
        m.type as last_type, m.content as last_content, m.created_at as last_at
      FROM conversations c
      JOIN users u ON (u.id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END)
      LEFT JOIN messages m ON m.id = (
        SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY COALESCE(m.created_at, c.created_at) DESC
    `, [req.userId]);
    res.json({ conversations: result.rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Crear o recuperar conversación con otro usuario
conversationsRouter.post('/start', async (req: AuthRequest, res) => {
  const { username } = req.body;
  try {
    // Buscar el otro usuario
    const userResult = await db.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (!userResult.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const otherId = userResult.rows[0].id;

    // Ver si ya existe conversación
    const existing = await db.query(`
      SELECT id FROM conversations
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    `, [req.userId, otherId]);

    let convId;
    if (existing.rows[0]) {
      convId = existing.rows[0].id;
    } else {
      const created = await db.query(
        'INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id',
        [req.userId, otherId]
      );
      convId = created.rows[0].id;
    }

    res.json({
      conversationId: convId,
      user: { id: otherId, username: userResult.rows[0].username },
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Obtener mensajes de una conversación
conversationsRouter.get('/:id/messages', async (req: AuthRequest, res) => {
  try {
    const result = await db.query(`
      SELECT m.id, m.sender_id, m.type, m.content, m.media_id,
             m.security_level, m.expires_at, m.viewed_at, m.created_at
      FROM messages m
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
    `, [req.params.id]);
    res.json({ messages: result.rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Enviar mensaje de texto
conversationsRouter.post('/:id/messages', async (req: AuthRequest, res) => {
  const { content } = req.body;
  try {
    const result = await db.query(`
      INSERT INTO messages (conversation_id, sender_id, type, content)
      VALUES ($1, $2, 'text', $3)
      RETURNING *
    `, [req.params.id, req.userId, content]);
    res.json({ message: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});
