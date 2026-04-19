node --input-type=module -e "
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = await import('sql.js');
const db = new SQL.Database(readFileSync('server/data/photo-index.db'));
const res = db.exec(\"SELECT id, status, path FROM photos WHERE status IN ('processing', 'error') LIMIT 20\");
console.log(res[0] ? res[0].values : 'empty');
"