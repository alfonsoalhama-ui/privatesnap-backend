import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import * as crypto from 'crypto';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

// Subir archivo cifrado — se guarda en la base de datos
mediaRouter.post('/upload', async (req: AuthRequest, res: Response) => {
  try {
    const { data, iv, mediaType, conversationId, recipientId, expiryOption, securityLevel } = req.body;

    if (!data || !iv) {
      res.status(400).json({ error: 'Missing encrypted data' });
      return;
    }

    const mediaId = crypto.randomUUID();

    // Calcular expiración
    const expiryMap: Record<string, number | null> = {
      '1x': null,
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const expiryMs = expiryMap[expiryOption ?? '24h'];
    const expiresAt = expiryMs ? new Date(Date.now() + expiryMs) : null;

    // Guardar en base de datos (datos cifrados — el servidor no puede ver el contenido)
    await db.query(`
      INSERT INTO media (id, uploader_id, conversation_id, recipient_id, media_type, iv, encrypted_data, security_level, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [mediaId, req.userId, conversationId, recipientId, mediaType, iv, data, securityLevel || 1, expiresAt]);

    res.json({ mediaId });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Descargar archivo cifrado
mediaRouter.get('/:mediaId', async (req: AuthRequest, res: Response) => {
  try {
    const { mediaId } = req.params;

    const result = await db.query(
      'SELECT * FROM media WHERE id = $1',
      [mediaId]
    );

    const media = result.rows[0];
    if (!media) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    // Solo el receptor o el emisor pueden acceder
    if (media.recipient_id !== req.userId && media.uploader_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Verificar expiración por tiempo
    if (media.expires_at && new Date(media.expires_at) < new Date()) {
      await db.query('DELETE FROM media WHERE id = $1', [mediaId]);
      res.status(410).json({ error: 'Media expired' });
      return;
    }

    // Verificar si ya fue visto (modo 1x)
    if (!media.expires_at && media.viewed_at) {
      res.status(410).json({ error: 'Media already viewed' });
      return;
    }

    // Marcar como visto
    await db.query('UPDATE media SET viewed_at = NOW() WHERE id = $1', [mediaId]);

    // Si es modo 1x, borrar tras 10 segundos
    if (!media.expires_at) {
      setTimeout(async () => {
        await db.query('DELETE FROM media WHERE id = $1', [mediaId]);
      }, 10000);
    }

    res.json({
      data: media.encrypted_data,
      iv: media.iv,
      mediaType: media.media_type,
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
});
