import { Hono } from 'hono';
import { getDb } from '../db.js';
import os from 'os';

export const settingsRouter = new Hono();

// GET /api/system/info — OS platform info so the frontend can suggest correct paths
settingsRouter.get('/system/info', (c) => {
  const platform = process.platform; // 'win32' | 'linux' | 'darwin'
  const homedir = os.homedir();      // e.g. C:\Users\Alice  or  /home/alice
  const sep = platform === 'win32' ? '\\' : '/';
  return c.json({ platform, homedir, sep });
});

// GET /api/settings — return all settings as flat object
settingsRouter.get('/settings', (c) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, unknown> = { id: 'default' };
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return c.json(settings);
});

// GET /api/settings/:key
settingsRouter.get('/settings/:key', (c) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM settings WHERE key = @key').get({ key: c.req.param('key') }) as { key: string; value: string } | undefined;
  if (!row) return c.json({ key: c.req.param('key'), value: null });
  return c.json({ key: row.key, value: JSON.parse(row.value) });
});

// PUT /api/settings — bulk update
settingsRouter.put('/settings', async (c) => {
  const db = getDb();
  const body = await c.req.json();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, unixepoch('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('now')
  `);
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) {
      upsert.run({ key, value: JSON.stringify(value) });
    }
  });
  const entries = Object.entries(body).filter(([k]) => k !== 'id');
  tx(entries);
  return c.json({ success: true });
});

// PUT /api/settings/:key
settingsRouter.put('/settings/:key', async (c) => {
  const db = getDb();
  const body = await c.req.json();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, unixepoch('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('now')
  `).run({ key: c.req.param('key'), value: JSON.stringify(body.value) });
  return c.json({ success: true });
});
