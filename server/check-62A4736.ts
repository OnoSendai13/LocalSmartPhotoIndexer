import { initDb, getDb } from './src/db.js';
await initDb();
const db = getDb();
const photos = db.prepare("SELECT id, name, folder_path, path FROM photos WHERE name LIKE '%_62A4736%'").all();
console.log(JSON.stringify(photos, null, 2));