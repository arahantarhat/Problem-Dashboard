import { loadConfig } from '../server/config.mjs';
import { migrateDatabase, openDatabase } from '../server/db.mjs';

loadConfig();
const db = openDatabase();
try {
  await migrateDatabase(db);
  console.log('PostgreSQL schema is up to date.');
} finally {
  await db.end();
}
