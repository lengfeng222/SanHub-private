import { createDatabaseAdapter, type DatabaseAdapter } from './db-adapter';

let adapter: DatabaseAdapter | null = null;
let initialized = false;

function getAdapter(): DatabaseAdapter {
  if (!adapter) adapter = createDatabaseAdapter();
  return adapter;
}

export async function initializeCaptchaTable(): Promise<void> {
  if (initialized) return;
  const db = getAdapter();
  const dbType = process.env.DB_TYPE || 'sqlite';

  if (dbType === 'mysql') {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS captcha_codes (
        id VARCHAR(64) PRIMARY KEY,
        code VARCHAR(16) NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_captcha_expires (expires_at)
      )
    `);
  } else {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS captcha_codes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    try {
      await db.execute('CREATE INDEX IF NOT EXISTS idx_captcha_expires ON captcha_codes(expires_at)');
    } catch {}
  }

  initialized = true;
}

export async function saveCaptchaCode(id: string, code: string, expiresAt: number) {
  await initializeCaptchaTable();
  const db = getAdapter();
  const now = Date.now();

  await db.execute('DELETE FROM captcha_codes WHERE expires_at < ?', [now]).catch(() => {});
  await db.execute('DELETE FROM captcha_codes WHERE id = ?', [id]).catch(() => {});
  await db.execute(
    `INSERT INTO captcha_codes (id, code, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
    [id, code.toUpperCase(), expiresAt, now]
  );
}

export async function getCaptchaCode(id: string) {
  await initializeCaptchaTable();
  const db = getAdapter();
  const [rows] = await db.execute(
    'SELECT * FROM captcha_codes WHERE id = ? LIMIT 1',
    [id]
  );
  return (rows as any[])[0] || null;
}

export async function deleteCaptchaCode(id: string) {
  await initializeCaptchaTable();
  const db = getAdapter();
  await db.execute('DELETE FROM captcha_codes WHERE id = ?', [id]);
}
