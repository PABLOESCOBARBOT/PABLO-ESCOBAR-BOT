import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set. On Railway: Variables → Add Reference → Postgres → DATABASE_URL",
    );
  }
  return url;
}

// Lazy pool so Express can bind before DB is checked
let _pool: pg.Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    if (!_pool) {
      _pool = new Pool({ connectionString: requireDatabaseUrl() });
    }
    const value = Reflect.get(_pool, prop, receiver);
    return typeof value === "function" ? value.bind(_pool) : value;
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    if (!_db) {
      _db = drizzle(pool, { schema });
    }
    const value = Reflect.get(_db, prop, receiver);
    return typeof value === "function" ? value.bind(_db) : value;
  },
});

export * from "./schema";
