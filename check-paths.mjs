import { Database } from 'better-sqlite3';

const db = new Database('C:\\Users\\neuro\\Documents\\LocalSmartPhotoIndexer\\server\\data\\photo-index.db');

const photos = db.prepare(`
  SELECT id, name, folder_path, path
  FROM photos
  WHERE name LIKE '%_36A9558%'
  LIMIT 5
`).all();

console.log(JSON.stringify(photos, null, 2));

db.close();
