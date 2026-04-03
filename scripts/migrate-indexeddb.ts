/**
 * One-time migration script — imports Chrome IndexedDB data into the backend SQLite.
 *
 * Chrome's IndexedDB cannot be read directly from Node.js, so this script
 * reads from an exported JSON backup file instead.
 *
 * Usage:
 *   1. In the OLD app (before migration), click the database icon → "Export Backup"
 *      Save the file as `backup.json` in the project root.
 *   2. Make sure the backend server is running: `npm run server`
 *   3. Run this script: npm run migrate
 *
 * The migration is idempotent — running multiple times is safe (uses INSERT OR IGNORE).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001';

async function main() {
  const backupPath = resolve(process.argv[2] ?? 'backup.json');

  console.log(`\n📦 LocalSmartPhotoIndexer — IndexedDB → SQLite Migration`);
  console.log(`   Backup file: ${backupPath}`);
  console.log(`   API target:  ${API_BASE}`);
  console.log('');

  // 1. Check API health
  console.log('🔌 Checking API connection...');
  let healthRes: Response;
  try {
    healthRes = await fetch(`${API_BASE}/api/health`);
  } catch (err) {
    console.error(`❌ Cannot reach backend at ${API_BASE}/api/health`);
    console.error('   Make sure the server is running: npm run server');
    process.exit(1);
  }

  if (!healthRes.ok) {
    console.error(`❌ Backend returned HTTP ${healthRes.status}`);
    process.exit(1);
  }
  console.log('✅ Backend is reachable\n');

  // 2. Read backup file
  let backupData: { photos?: unknown[]; settings?: Record<string, unknown> };
  try {
    const raw = readFileSync(backupPath, 'utf-8');
    backupData = JSON.parse(raw);
    console.log(`📄 Backup file loaded:`);
    console.log(`   Photos:  ${(backupData.photos ?? []).length} entries`);
    console.log(`   Settings: ${backupData.settings ? 'yes' : 'no'}\n`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`❌ Backup file not found: ${backupPath}`);
      console.error('   Export it from the app first: Database icon → "Export Backup"');
      process.exit(1);
    }
    throw err;
  }

  // 3. Migrate photos
  const photos = backupData.photos ?? [];
  if (photos.length === 0) {
    console.log('ℹ️  No photos to import — nothing to do.');
  } else {
    console.log(`📸 Importing ${photos.length} photos...`);
    const res = await fetch(`${API_BASE}/api/photos/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos,
        settings: backupData.settings,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Import failed: HTTP ${res.status} — ${errText}`);
      process.exit(1);
    }

    const result = await res.json() as { photosImported: number };
    console.log(`✅ Imported ${result.photosImported} photos\n`);
  }

  // 4. Migrate settings
  if (backupData.settings) {
    console.log('⚙️  Importing settings...');
    const settingsRes = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData.settings),
    });

    if (!settingsRes.ok) {
      console.warn(`⚠️  Settings import failed (HTTP ${settingsRes.status}) — settings may need manual re-entry.`);
    } else {
      console.log('✅ Settings imported\n');
    }
  }

  // 5. Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Migration complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start the app: npm run dev:all');
  console.log('  2. Your photos should now load from SQLite');
  console.log('  3. The backup.json file is no longer needed');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});
