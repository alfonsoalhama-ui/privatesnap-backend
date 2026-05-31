import { Pool } from 'pg';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user1_id UUID REFERENCES users(id),
      user2_id UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES conversations(id),
      sender_id UUID REFERENCES users(id),
      type VARCHAR(10) NOT NULL DEFAULT 'text',
      content TEXT,
      media_id TEXT,
      security_level INT DEFAULT 1,
      expires_at TIMESTAMP,
      viewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploader_id UUID REFERENCES users(id),
      recipient_id UUID REFERENCES users(id),
      conversation_id UUID REFERENCES conversations(id),
      media_type VARCHAR(10) NOT NULL DEFAULT 'image',
      iv TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      security_level INT DEFAULT 1,
      expires_at TIMESTAMP,
      viewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Database tables ready');
}
