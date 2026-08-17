import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema, SCHEMA_VERSION } from "./schema.js";

export const INDEXER_VERSION = "0.1.0";

export interface InitializedIndex {
  repositoryRoot: string;
  databasePath: string;
  fileCount: number;
  symbolCount: number;
}

export interface IndexedSymbol {
  name: string;
  qualifiedName: string;
  kind: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  signature: string | null;
}

export interface IndexedFile {
  path: string;
  symbols: readonly IndexedSymbol[];
}

export function initializeIndex(
  repositoryPath: string,
  files: readonly IndexedFile[],
): InitializedIndex {
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
    const insertFile = database.prepare("INSERT INTO files (path) VALUES (?)");
    const insertSymbol = database.prepare(`
      INSERT INTO symbols (
        file_id, name, qualified_name, kind,
        start_line, start_column, end_line, end_column, signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    database.exec("BEGIN");
    insertMetadata.run("schema_version", SCHEMA_VERSION);
    insertMetadata.run("repository_root", repositoryRoot);
    insertMetadata.run("indexed_at", new Date().toISOString());
    insertMetadata.run("indexer_version", INDEXER_VERSION);

    for (const file of files) {
      const fileId = insertFile.run(file.path).lastInsertRowid;

      for (const symbol of file.symbols) {
        insertSymbol.run(
          fileId,
          symbol.name,
          symbol.qualifiedName,
          symbol.kind,
          symbol.startLine,
          symbol.startColumn,
          symbol.endLine,
          symbol.endColumn,
          symbol.signature,
        );
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    database.close();
  }

  return {
    repositoryRoot,
    databasePath,
    fileCount: files.length,
    symbolCount: files.reduce((count, file) => count + file.symbols.length, 0),
  };
}
