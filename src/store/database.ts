import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema, SCHEMA_VERSION } from "./schema.js";

export const INDEXER_VERSION = "0.1.0";

export interface InitializedIndex {
  repositoryRoot: string;
  databasePath: string;
}

export function initializeIndex(repositoryPath: string): InitializedIndex {
  const repositoryRoot = resolve(repositoryPath);

  if (!statSync(repositoryRoot).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repositoryRoot}`);
  }

  const ariDirectory = join(repositoryRoot, ".ari");
  const databasePath = join(ariDirectory, "index.sqlite");
  mkdirSync(ariDirectory, { recursive: true });
  rmSync(databasePath, { force: true });

  const database = new DatabaseSync(databasePath);

  try {
    initializeSchema(database);
    const insertMetadata = database.prepare(
      "INSERT INTO metadata (key, value) VALUES (?, ?)",
    );

    database.exec("BEGIN");
    insertMetadata.run("schema_version", SCHEMA_VERSION);
    insertMetadata.run("repository_root", repositoryRoot);
    insertMetadata.run("indexed_at", new Date().toISOString());
    insertMetadata.run("indexer_version", INDEXER_VERSION);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    database.close();
  }

  return { repositoryRoot, databasePath };
}
