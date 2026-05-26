import { createDatabaseAdapter, type DatabaseAdapter } from './db-adapter';
import { generateId } from './utils';

let adapter: DatabaseAdapter | null = null;
let initialized = false;

function getAdapter(): DatabaseAdapter {
  if (!adapter) adapter = createDatabaseAdapter();
  return adapter;
}

export async function initializeEmailCodeTable(): Promise<void> {
  if (initialized) return;
  const db = getAdapter();
  const dbType = process.env.DB_TYPE || 'sqlite';

  if (dbType === 'mysql') {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(191) NOT NULL,
        code VARCHAR(16) NOT NULL,
        attempts INT DEFAULT 0,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_email_created (email, created_at)
      )
    `);
  } else {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_email_created ON email_verification_codes(email, created_at)'); } catch {}
  }

  initialized = true;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function saveEmailVerificationCode(email: string, code: string, expiresAt: number) {
  await initializeEmailCodeTable();
  const db = getAdapter();
  const normalized = normalizeEmail(email);
  const now = Date.now();

  await db.execute('DELETE FROM email_verification_codes WHERE email = ?', [normalized]).catch(() => {});
  await db.execute(
    `INSERT INTO email_verification_codes (id, email, code, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [generateId(), normalized, code, expiresAt, now]
  );
}

export async function getLatestEmailVerificationCode(email: string) {
  await initializeEmailCodeTable();
  const db = getAdapter();
  const normalized = normalizeEmail(email);
  const [rows] = await db.execute(
    'SELECT * FROM email_verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    [normalized]
  );
  return (rows as any[])[0] || null;
}

export async function incrementEmailCodeAttempts(email: string) {
  await initializeEmailCodeTable();
  const db = getAdapter();
  const normalized = normalizeEmail(email);
  await db.execute(
    `UPDATE email_verification_codes
     SET attempts = attempts + 1
     WHERE email = ? AND created_at = (
       SELECT MAX(created_at) FROM email_verification_codes WHERE email = ?
     )`,
    [normalized, normalized]
  );
}

export async function deleteEmailVerificationCode(email: string) {
  await initializeEmailCodeTable();
  const db = getAdapter();
  const normalized = normalizeEmail(email);
  await db.execute('DELETE FROM email_verification_codes WHERE email = ?', [normalized]);
}

