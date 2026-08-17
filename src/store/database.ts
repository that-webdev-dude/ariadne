import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  symbolReferenceKey,
  type ExtractedIndex,
  type SymbolReference,
} from "../records.js";
import { initializeSchema, SCHEMA_VERSION } from "./schema.js";

export const INDEXER_VERSION = "0.1.0";

export interface InitializedIndex {
  repositoryRoot: string;
  databasePath: string;
  fileCount: number;
  symbolCount: number;
  importCount: number;
  callCount: number;
}

export function initializeIndex(
  repositoryPath: string,
  index: ExtractedIndex,
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
    const insertImport = database.prepare(`
      INSERT INTO imports (source_file_id, target_file_id, specifier)
      VALUES (?, ?, ?)
    `);
    const insertCall = database.prepare(`
      INSERT INTO relationships (source_symbol_id, target_symbol_id)
      VALUES (?, ?)
    `);
    const fileIds = new Map<string, number | bigint>();
    const symbolIds = new Map<string, number | bigint>();

    database.exec("BEGIN");
    insertMetadata.run("schema_version", SCHEMA_VERSION);
    insertMetadata.run("repository_root", repositoryRoot);
    insertMetadata.run("indexed_at", new Date().toISOString());
    insertMetadata.run("indexer_version", INDEXER_VERSION);

    for (const file of index.files) {
      const fileId = insertFile.run(file.path).lastInsertRowid;
      fileIds.set(file.path, fileId);

      for (const symbol of file.symbols) {
        const symbolId = insertSymbol.run(
          fileId,
          symbol.name,
          symbol.qualifiedName,
          symbol.kind,
          symbol.startLine,
          symbol.startColumn,
          symbol.endLine,
          symbol.endColumn,
          symbol.signature,
        ).lastInsertRowid;
        const reference: SymbolReference = {
          filePath: file.path,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          startLine: symbol.startLine,
          startColumn: symbol.startColumn,
        };
        symbolIds.set(symbolReferenceKey(reference), symbolId);
      }
    }

    for (const importedFile of index.imports) {
      insertImport.run(
        requireId(fileIds, importedFile.sourcePath, "file"),
        requireId(fileIds, importedFile.targetPath, "file"),
        importedFile.specifier,
      );
    }

    for (const call of index.calls) {
      insertCall.run(
        requireId(
          symbolIds,
          symbolReferenceKey(call.sourceSymbol),
          "symbol",
        ),
        requireId(
          symbolIds,
          symbolReferenceKey(call.targetSymbol),
          "symbol",
        ),
      );
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
    fileCount: index.files.length,
    symbolCount: index.files.reduce(
      (count, file) => count + file.symbols.length,
      0,
    ),
    importCount: index.imports.length,
    callCount: index.calls.length,
  };
}

function requireId(
  ids: ReadonlyMap<string, number | bigint>,
  key: string,
  kind: "file" | "symbol",
): number | bigint {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`Cannot persist relationship for unknown ${kind}: ${key}`);
  }

  return id;
}
