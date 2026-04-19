import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import path from 'path';

const SQL = await initSqlJs();
const dbPath = path.resolve(process.cwd(), 'data/photo-index.db');
console.log('DB path:', dbPath);
const db = new SQL.Database(readFileSync(dbPath));
const counts = db.exec("SELECT status, COUNT(*) FROM photos GROUP BY status");
if (counts[0]) {
  console.log('Total by status:', counts[0].values);
} else {
  console.log('No photos in DB at all');
}
const total = db.exec("SELECT COUNT(*) FROM photos");
console.log('Total photos:', total[0] ? total[0].values[0][0] : 0);
db.close();