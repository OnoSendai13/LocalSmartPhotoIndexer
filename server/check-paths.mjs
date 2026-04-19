import { getDb } from './src/db.js';

const db = getDb();

const photos = db.prepare(`
  SELECT id, name, folder_path, path
  FROM photos
  WHERE name LIKE '%_36A9558%'
  LIMIT 5
`).all();

console.log(JSON.stringify(photos, null, 2));
