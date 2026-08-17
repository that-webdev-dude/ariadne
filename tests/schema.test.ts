import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../src/store/schema.js";

const expectedTables = ["files", "imports", "metadata", "relationships", "symbols"];
const expectedIndexes = [
  "idx_relationships_source_symbol_id",
  "idx_relationships_target_symbol_id",
  "idx_symbols_name",
  "idx_symbols_qualified_name",
];

test("schema initialization creates the P0 tables and lookup indexes", () => {
  const database = new DatabaseSync(":memory:");

  try {
    initializeSchema(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.deepEqual(tables, expectedTables);
    assert.deepEqual(indexes, expectedIndexes);
    assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  } finally {
    database.close();
  }
});
