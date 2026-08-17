import { createSymbolId } from "../symbolId.js";
import {
  AriadneRepository,
  type StoredSymbol,
  type SymbolSearchKind,
} from "../store/repository.js";
import type {
  DependencyResult,
  DependentResult,
  FindSymbolResult,
  QueryLimitOptions,
  RepoOverview,
  SymbolDescription,
  SymbolMatchKind,
  SymbolSummary,
} from "./types.js";

export const DEFAULT_FIND_LIMIT = 10;
export const DEFAULT_RELATION_LIMIT = 20;
export const MAX_QUERY_LIMIT = 100;

const TOP_LEVEL_PATH_LIMIT = 20;
const ENTRY_CANDIDATE_LIMIT = 10;

const searchOrder: ReadonlyArray<{
  repositoryKind: SymbolSearchKind;
  match: SymbolMatchKind;
}> = [
  { repositoryKind: "exactQualified", match: "exact_qualified" },
  { repositoryKind: "exactName", match: "exact_name" },
  { repositoryKind: "suffix", match: "suffix" },
  { repositoryKind: "prefix", match: "prefix" },
  { repositoryKind: "substring", match: "substring" },
];

export class AriadneQueryService {
  constructor(private readonly repository: AriadneRepository) {}

  close(): void {
    this.repository.close();
  }

  repoOverview(): RepoOverview {
    const metadata = this.repository.getMetadata();

    return {
      repositoryRoot: metadata.repositoryRoot ?? this.repository.repositoryRoot,
      indexedAt: metadata.indexedAt,
      indexerVersion: metadata.indexerVersion,
      counts: this.repository.getCounts(),
      topLevelPaths: this.repository.getTopLevelPaths(TOP_LEVEL_PATH_LIMIT),
      entryCandidates: this.repository
        .getEntryCandidates(ENTRY_CANDIDATE_LIMIT)
        .map(toSymbolSummary),
    };
  }

  findSymbol(query: string, options: QueryLimitOptions = {}): FindSymbolResult {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new Error("Symbol query must not be empty");
    }

    const limit = normalizeLimit(options.limit, DEFAULT_FIND_LIMIT);
    const matches: FindSymbolResult["matches"] = [];
    const seen = new Set<string>();

    for (const { repositoryKind, match } of searchOrder) {
      for (const symbol of this.repository.searchSymbols(
        normalizedQuery,
        repositoryKind,
        limit,
      )) {
        const summary = toSymbolSummary(symbol);
        if (!seen.has(summary.id)) {
          seen.add(summary.id);
          matches.push({ ...summary, match });
        }

        if (matches.length === limit) {
          return { query: normalizedQuery, matches };
        }
      }
    }

    return { query: normalizedQuery, matches };
  }

  describeSymbol(
    symbolId: string,
    options: QueryLimitOptions = {},
  ): SymbolDescription | null {
    const symbol = this.repository.getSymbolById(symbolId);
    if (symbol === null) {
      return null;
    }

    const limit = normalizeLimit(options.limit, DEFAULT_RELATION_LIMIT);
    const calls = this.repository.getOutgoingCalls(symbolId, limit);
    const calledBy = this.repository.getIncomingCalls(symbolId, limit);

    return {
      symbol: {
        ...toSymbolSummary(symbol),
        signature: symbol.signature,
        startLine: symbol.startLine,
        startColumn: symbol.startColumn,
        endLine: symbol.endLine,
        endColumn: symbol.endColumn,
      },
      calls: calls.symbols.map(toSymbolSummary),
      calledBy: calledBy.symbols.map(toSymbolSummary),
      callsTruncated: calls.truncated,
      calledByTruncated: calledBy.truncated,
    };
  }

  dependencies(
    symbolId: string,
    options: QueryLimitOptions = {},
  ): DependencyResult | null {
    const symbol = this.repository.getSymbolById(symbolId);
    if (symbol === null) {
      return null;
    }

    const related = this.repository.getOutgoingCalls(
      symbolId,
      normalizeLimit(options.limit, DEFAULT_RELATION_LIMIT),
    );

    return {
      symbol: toSymbolSummary(symbol),
      dependencies: related.symbols.map(toSymbolSummary),
      truncated: related.truncated,
    };
  }

  dependents(
    symbolId: string,
    options: QueryLimitOptions = {},
  ): DependentResult | null {
    const symbol = this.repository.getSymbolById(symbolId);
    if (symbol === null) {
      return null;
    }

    const related = this.repository.getIncomingCalls(
      symbolId,
      normalizeLimit(options.limit, DEFAULT_RELATION_LIMIT),
    );

    return {
      symbol: toSymbolSummary(symbol),
      dependents: related.symbols.map(toSymbolSummary),
      truncated: related.truncated,
    };
  }
}

export function openQueryService(repositoryPath: string): AriadneQueryService {
  return new AriadneQueryService(AriadneRepository.open(repositoryPath));
}

function toSymbolSummary(symbol: StoredSymbol): SymbolSummary {
  return {
    id: createSymbolId({
      filePath: symbol.filePath,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      startLine: symbol.startLine,
      startColumn: symbol.startColumn,
    }),
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    file: symbol.filePath,
    line: symbol.startLine,
  };
}

function normalizeLimit(value: number | undefined, defaultLimit: number): number {
  if (value === undefined) {
    return defaultLimit;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Query limit must be a positive integer");
  }

  return Math.min(value, MAX_QUERY_LIMIT);
}
