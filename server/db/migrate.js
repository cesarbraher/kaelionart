import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

export function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((stmt) =>
      stmt
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

export async function runMigrations(config = loadConfig()) {
  if (config.dbDriver !== 'mysql') {
    throw new Error('Las migraciones SQL requieren DB_DRIVER=mysql');
  }
  if (!config.mysql.database || !config.mysql.user) {
    throw new Error('Configura MYSQL_DATABASE, MYSQL_USER y MYSQL_PASSWORD antes de ejecutar migraciones');
  }

  const options = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    timezone: 'Z',
    connectTimeout: 10000,
  };
  if (config.mysql.tls) {
    options.ssl = { rejectUnauthorized: true };
    if (config.mysql.ca) options.ssl.ca = config.mysql.ca;
  }

  const { default: mysql } = await import('mysql2/promise');
  const conn = await mysql.createConnection(options);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(128) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [appliedRows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.version));
    const files = listMigrationFiles();
    const newlyApplied = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const statements = splitSqlStatements(sql);

      await conn.beginTransaction();
      try {
        for (const statement of statements) {
          await conn.query(statement);
        }
        await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
        await conn.commit();
        newlyApplied.push(file);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    return { applied: newlyApplied, total: files.length };
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMigrations()
    .then(({ applied, total }) => {
      if (applied.length === 0) {
        console.log(`Migraciones al día (${total} registradas).`);
      } else {
        console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
      }
    })
    .catch((err) => {
      console.error('Error al aplicar migraciones:', err.message);
      process.exitCode = 1;
    });
}
