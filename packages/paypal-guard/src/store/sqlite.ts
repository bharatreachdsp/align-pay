import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type DocBackend, DocStore } from "./docs";

/** SQLite through Node's built-in `node:sqlite` (Node 22.13+), so there is nothing native to build. */
class SqliteBackend implements DocBackend {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
    this.db = new DatabaseSync(/*turbopackIgnore: true*/ file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS docs (
        col TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (col, id)
      );
    `);
  }
  get(col: string, id: string) {
    const row = this.db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").get(col, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put(col: string, id: string, doc: unknown) {
    this.db
      .prepare(
        "INSERT INTO docs (col, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(col, id, JSON.stringify(doc), new Date().toISOString());
  }
  insertIfAbsent(col: string, id: string, doc: unknown) {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO docs (col, id, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(col, id, JSON.stringify(doc), new Date().toISOString());
    return Number(r.changes) > 0;
  }
  list(col: string) {
    return (this.db.prepare("SELECT data FROM docs WHERE col = ?").all(col) as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  del(col: string, id: string) {
    this.db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").run(col, id);
  }
  clear(col: string) {
    this.db.prepare("DELETE FROM docs WHERE col = ?").run(col);
  }
}

export function sqliteStore(file: string): DocStore {
  return new DocStore(new SqliteBackend(file));
}
