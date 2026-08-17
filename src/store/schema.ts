import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = "1";

export function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE
    ) STRICT;

    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      start_column INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      end_column INTEGER NOT NULL,
      signature TEXT
    ) STRICT;

    CREATE TABLE imports (
      id INTEGER PRIMARY KEY,
      source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      specifier TEXT NOT NULL,
      UNIQUE (source_file_id, target_file_id, specifier)
    ) STRICT;

    CREATE TABLE relationships (
      id INTEGER PRIMARY KEY,
      source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
      target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
      UNIQUE (source_symbol_id, target_symbol_id)
    ) STRICT;

    CREATE INDEX idx_symbols_name ON symbols(name);
    CREATE INDEX idx_symbols_qualified_name ON symbols(qualified_name);
    CREATE INDEX idx_relationships_source_symbol_id ON relationships(source_symbol_id);
    CREATE INDEX idx_relationships_target_symbol_id ON relationships(target_symbol_id);
  `);
}
