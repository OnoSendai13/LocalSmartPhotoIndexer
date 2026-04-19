import { existsSync } from 'fs';
import { join } from 'path';
import { initDb, getDb } from './src/db.js';
await initDb();
const db = getDb();

const photos = db.prepare("SELECT * FROM photos WHERE name LIKE '%62A4736%'").all();
for (const p of photos) {
  console.log('---');
  console.log('name:', p.name);
  console.log('folder_path:', p.folder_path);
  console.log('path:', p.path);
  console.log('status:', p.status);
  
  // Test each path
  if (p.path) console.log('path exists:', existsSync(p.path));
  if (p.folder_path && p.name) {
    const joined = join(p.folder_path, p.name);
    console.log('joined:', joined);
    console.log('joined exists:', existsSync(joined));
  }
}
