import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'photo-index.db');

function getReport(db) {
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM photos').get();
  const statusRows = db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM photos
      GROUP BY status
    `)
    .all();

  const byStatus = {
    pending: 0,
    processing: 0,
    processed: 0,
    error: 0,
  };

  for (const row of statusRows) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) {
      byStatus[row.status] = row.count;
    }
  }

  return {
    total: totalRow?.total ?? 0,
    byStatus,
  };
}

function printReport(title, report) {
  console.log(`\n=== ${title} ===`);
  console.log(`Total photos: ${report.total}`);
  console.log(`pending:    ${report.byStatus.pending}`);
  console.log(`processing: ${report.byStatus.processing}`);
  console.log(`processed:  ${report.byStatus.processed}`);
  console.log(`error:      ${report.byStatus.error}`);
}

async function main() {
  if (!existsSync(dbPath)) {
    console.error(`❌ Base de données introuvable: ${dbPath}`);
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPath);
  const rl = readline.createInterface({ input, output });

  try {
    console.log(`📂 Base utilisée: ${dbPath}`);

    const beforeReport = getReport(db);
    printReport('RAPPORT AVANT', beforeReport);

    const answer = await rl.question(
      "\n⚠️  Confirmer la réinitialisation des photos en statut 'error' vers 'pending' ? Tapez OUI pour confirmer: ",
    );

    if (answer.trim().toUpperCase() !== 'OUI') {
      console.log('⏹️  Opération annulée. Aucune modification effectuée.');
      return;
    }

    const updateStmt = db.prepare(`
      UPDATE photos
      SET status = 'pending',
          updated_at = unixepoch('now')
      WHERE status = 'error'
    `);

    const result = updateStmt.run();
    console.log(`\n✅ ${result.changes} photo(s) réinitialisée(s) de 'error' vers 'pending'.`);

    const afterReport = getReport(db);
    printReport('RAPPORT APRÈS', afterReport);
  } catch (error) {
    console.error('❌ Erreur pendant la réinitialisation:', error);
    process.exitCode = 1;
  } finally {
    rl.close();
    db.close();
  }
}

void main();
