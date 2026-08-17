import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SymbolKind } from "../records.js";
import { parseSymbolId } from "../symbolId.js";

export type SymbolSearchKind =
  | "exactQualified"
  | "exactName"
  | "suffix"
  | "prefix"
  | "substring";

export interface StoredSymbol {
  filePath: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  signature: string | null;
}

export interface IndexMetadata {
  repositoryRoot: string | null;
  indexedAt: string | null;
  indexerVersion: string | null;
}

export interface IndexCounts {
  files: number;
  symbols: number;
  imports: number;
  calls: number;
}

export interface RelatedSymbols {
  symbols: StoredSymbol[];
  truncated: boolean;
}

export class AriadneIndexNotFoundError extends Error {
  constructor(databasePath: string) {
    super(`Ariadne index not found: ${databasePath}`);
    this.name = "AriadneIndexNotFoundError";
  }
}

const symbolColumns = `
  SELECT
    files.path AS filePath,
    symbols.name,
    symbols.qualified_name AS qualifiedName,
    symbols.kind,
    symbols.start_line AS startLine,
    symbols.start_column AS startColumn,
    symbols.end_line AS endLine,
    symbols.end_column AS endColumn,
    symbols.signature
  FROM symbols
  JOIN files ON files.id = symbols.file_id
`;

const symbolOrder = `
  ORDER BY files.path, symbols.qualified_name, symbols.start_line,
    symbols.start_column, symbols.kind, symbols.name
`;

export class AriadneRepository {
  readonly repositoryRoot: string;
  readonly databasePath: string;

  private constructor(
    repositoryRoot: string,
    databasePath: string,
    private readonly database: DatabaseSync,
  ) {
    this.repositoryRoot = repositoryRoot;
    this.databasePath = databasePath;
  }

  static open(repositoryPath: string): AriadneRepository {
    const repositoryRoot = resolve(repositoryPath);
    const databasePath = join(repositoryRoot, ".ari", "index.sqlite");

    if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
      throw new AriadneIndexNotFoundError(databasePath);
    }

    return new AriadneRepository(
      repositoryRoot,
      databasePath,
      new DatabaseSync(databasePath, { readOnly: true }),
    );
  }

  close(): void {
    this.database.close();
  }

  getMetadata(): IndexMetadata {
    const metadata = new Map(
      (this.database.prepare("SELECT key, value FROM metadata").all() as Array<{
        key: string;
        value: string;
      }>).map(({ key, value }) => [key, value]),
    );

    return {
      repositoryRoot: metadata.get("repository_root") ?? null,
      indexedAt: metadata.get("indexed_at") ?? null,
      indexerVersion: metadata.get("indexer_version") ?? null,
    };
  }

  getCounts(): IndexCounts {
    const row = this.database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM files) AS files,
          (SELECT COUNT(*) FROM symbols) AS symbols,
          (SELECT COUNT(*) FROM imports) AS imports,
          (SELECT COUNT(*) FROM relationships) AS calls
      `)
      .get() as unknown as IndexCounts;

    return {
      files: row.files,
      symbols: row.symbols,
      imports: row.imports,
      calls: row.calls,
    };
  }

  getTopLevelPaths(limit: number): string[] {
    return this.database
      .prepare(`
        SELECT DISTINCT
          CASE
            WHEN instr(path, '/') = 0 THEN path
            ELSE substr(path, 1, instr(path, '/') - 1)
          END AS path
        FROM files
        ORDER BY path
        LIMIT ?
      `)
      .all(boundLimit(limit))
      .map((row) => row.path as string);
  }

  getEntryCandidates(limit: number): StoredSymbol[] {
    return this.database
      .prepare(`${symbolColumns}
        WHERE
          files.path = 'index.ts' OR substr(files.path, -9) = '/index.ts' OR
          files.path = 'main.ts' OR substr(files.path, -8) = '/main.ts'
        ${symbolOrder}
        LIMIT ?
      `)
      .all(boundLimit(limit)) as unknown as StoredSymbol[];
  }

  searchSymbols(
    query: string,
    kind: SymbolSearchKind,
    limit: number,
  ): StoredSymbol[] {
    const [where, parameters] = searchCondition(query, kind);

    return this.database
      .prepare(`${symbolColumns} WHERE ${where} ${symbolOrder} LIMIT ?`)
      .all(...parameters, boundLimit(limit)) as unknown as StoredSymbol[];
  }

  getSymbolById(symbolId: string): StoredSymbol | null {
    const identity = parseSymbolId(symbolId);
    if (identity === null) {
      return null;
    }

    const rows = this.database
      .prepare(`${symbolColumns}
        WHERE
          files.path = ? AND
          symbols.qualified_name = ? AND
          symbols.kind = ? AND
          symbols.start_line = ? AND
          symbols.start_column = ?
        LIMIT 2
      `)
      .all(
        identity.filePath,
        identity.qualifiedName,
        identity.kind,
        identity.startLine,
        identity.startColumn,
      ) as unknown as StoredSymbol[];

    return rows.length === 1 ? rows[0] ?? null : null;
  }

  getOutgoingCalls(symbolId: string, limit: number): RelatedSymbols {
    return this.getRelatedSymbols(symbolId, "outgoing", limit);
  }

  getIncomingCalls(symbolId: string, limit: number): RelatedSymbols {
    return this.getRelatedSymbols(symbolId, "incoming", limit);
  }

  private getRelatedSymbols(
    symbolId: string,
    direction: "outgoing" | "incoming",
    limit: number,
  ): RelatedSymbols {
    const identity = parseSymbolId(symbolId);
    if (identity === null) {
      return { symbols: [], truncated: false };
    }

    const internalId = this.database
      .prepare(`
        SELECT symbols.id
        FROM symbols
        JOIN files ON files.id = symbols.file_id
        WHERE
          files.path = ? AND
          symbols.qualified_name = ? AND
          symbols.kind = ? AND
          symbols.start_line = ? AND
          symbols.start_column = ?
        LIMIT 2
      `)
      .all(
        identity.filePath,
        identity.qualifiedName,
        identity.kind,
        identity.startLine,
        identity.startColumn,
      );

    if (internalId.length !== 1) {
      return { symbols: [], truncated: false };
    }

    const requestedLimit = boundLimit(limit);
    const sourceColumn =
      direction === "outgoing" ? "source_symbol_id" : "target_symbol_id";
    const relatedColumn =
      direction === "outgoing" ? "target_symbol_id" : "source_symbol_id";
    const rows = this.database
      .prepare(`
        SELECT
          files.path AS filePath,
          symbols.name,
          symbols.qualified_name AS qualifiedName,
          symbols.kind,
          symbols.start_line AS startLine,
          symbols.start_column AS startColumn,
          symbols.end_line AS endLine,
          symbols.end_column AS endColumn,
          symbols.signature
        FROM relationships
        JOIN symbols ON symbols.id = relationships.${relatedColumn}
        JOIN files ON files.id = symbols.file_id
        WHERE relationships.${sourceColumn} = ?
        ${symbolOrder}
        LIMIT ?
      `)
      .all(internalId[0]?.id as number, requestedLimit + 1) as unknown as StoredSymbol[];

    return {
      symbols: rows.slice(0, requestedLimit),
      truncated: rows.length > requestedLimit,
    };
  }
}

function searchCondition(
  query: string,
  kind: SymbolSearchKind,
): [where: string, parameters: string[]] {
  switch (kind) {
    case "exactQualified":
      return ["symbols.qualified_name = ?", [query]];
    case "exactName":
      return ["symbols.name = ?", [query]];
    case "suffix":
      return [
        "substr(symbols.qualified_name, -length(?)) = ?",
        [query, query],
      ];
    case "prefix":
      return [
        "substr(symbols.name, 1, length(?)) = ?",
        [query, query],
      ];
    case "substring":
      return ["instr(symbols.name, ?) > 0", [query]];
  }
}

function boundLimit(limit: number): number {
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}
