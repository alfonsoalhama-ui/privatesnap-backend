import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

// Directorio donde se guardan los archivos cifrados
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Subir archivo cifrado
mediaRouter.post('/upload', async (req: AuthRequest, res: Response) => {
  try {
    const { data, iv, mediaType, conversationId, recipientId, expiryOption, securityLevel } = req.body;

    if (!data || !iv) {
      res.status(400).json({ error: 'Missing encrypted data' });
      return;
    }

    // Generar ID único para el archivo
    const mediaId = crypto.randomUUID();
    const fileName = `${mediaId}.enc`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Guardar el archivo cifrado (el servidor solo ve bytes cifrados)
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);

    // Calcular expiración
    const expiryMap: Record<string, number> = {
      '1x': 0,
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const expiresAt = expiryOption === '1x'
      ? null
      : new Date(Date.now() + (expiryMap[expiryOption] || expiryMap['24h']));

    // Guardar metadatos en la base de datos
    await db.query(`
      INSERT INTO media (id, uploader_id, conversation_id, recipient_id, media_type, iv, security_level, expires_at, file_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [mediaId, req.userId, conversationId, recipientId, mediaType, iv, securityLevel || 1, expiresAt, fileName]);

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

    // Verificar que el receptor es quien pide el archivo
    if (media.recipient_id !== req.userId && media.uploader_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Verificar si expiró por tiempo
    if (media.expires_at && new Date(media.expires_at) < new Date()) {
      // Borrar archivo
      const filePath = path.join(UPLOAD_DIR, media.file_name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await db.query('DELETE FROM media WHERE id = $1', [mediaId]);
      res.status(410).json({ error: 'Media expired' });
      return;
    }

    // Verificar si ya fue visto (modo 1x)
    if (media.expires_at === null && media.viewed_at) {
      res.status(410).json({ error: 'Media already viewed' });
      return;
    }

    const filePath = path.join(UPLOAD_DIR, media.file_name);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Leer y devolver el archivo cifrado + IV
    const fileBuffer = fs.readFileSync(filePath);
    const data = fileBuffer.toString('base64');

    // Marcar como visto
    await db.query('UPDATE media SET viewed_at = NOW() WHERE id = $1', [mediaId]);

    // Si es modo 1x, borrar después de enviar
    if (media.expires_at === null) {
      setTimeout(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.query('DELETE FROM media WHERE id = $1', [mediaId]);
      }, 5000);
    }

    res.json({
      data,
      iv: media.iv,
      mediaType: media.media_type,
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
});
