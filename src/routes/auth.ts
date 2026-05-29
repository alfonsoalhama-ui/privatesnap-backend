import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db';

export const authRouter = Router();

// Registro
authRouter.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  if (username.length < 3) {
    res.status(400).json({ error: 'Username too short' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password too short' });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username.toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: 'Wrong username or password' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Wrong username or password' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Buscar usuario por username
authRouter.get('/user/:username', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});
