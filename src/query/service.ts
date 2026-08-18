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
const SYMBOL_CANDIDATE_LIMIT = MAX_QUERY_LIMIT;
// ponytail: one compact fallback ceiling; revisit only if benchmark evidence demands it.
const WEAK_RESULT_LIMIT = 12;

const fullSearches: ReadonlyArray<{
  repositoryKind: SymbolSearchKind;
  match: SymbolMatchKind;
  rank: number;
}> = [
  { repositoryKind: "exactName", match: "exact_name", rank: 0 },
  { repositoryKind: "exactQualified", match: "exact_qualified", rank: 1 },
  { repositoryKind: "prefix", match: "prefix", rank: 2 },
  { repositoryKind: "suffix", match: "suffix", rank: 3 },
  { repositoryKind: "substring", match: "substring", rank: 3 },
];

interface FullCandidate {
  symbol: StoredSymbol;
  match: SymbolMatchKind;
  rank: number;
}

interface RankedCandidate {
  symbol: StoredSymbol;
  match: SymbolMatchKind;
  rank: number;
  nameMatches: number;
  boundaryMatches: number;
  substringMatches: number;
  qualifiedNameMatches: number;
  pathMatches: number;
  nameTokens: readonly string[];
}

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
    const fullCandidates = new Map<string, FullCandidate>();

    for (const { repositoryKind, match, rank } of fullSearches) {
      for (const symbol of this.repository.searchSymbols(
        normalizedQuery,
        repositoryKind,
        SYMBOL_CANDIDATE_LIMIT,
      )) {
        const id = toSymbolSummary(symbol).id;
        const existing = fullCandidates.get(id);
        if (existing === undefined || rank < existing.rank) {
          fullCandidates.set(id, { symbol, match, rank });
        }
      }
    }

    const queryTokens = tokenizeIdentifier(normalizedQuery);
    const tokenSymbols = new Map<string, StoredSymbol>();
    for (const [id, { symbol }] of fullCandidates) {
      tokenSymbols.set(id, symbol);
    }

    for (const token of queryTokens) {
      for (const symbol of this.repository.searchSymbols(
        token,
        "token",
        SYMBOL_CANDIDATE_LIMIT,
      )) {
        tokenSymbols.set(toSymbolSummary(symbol).id, symbol);
      }
    }

    const candidates = [...tokenSymbols.entries()]
      .map(([id, symbol]) =>
        scoreCandidate(
          symbol,
          queryTokens,
          normalizedQuery,
          fullCandidates.get(id),
        ),
      )
      .filter(
        ({ rank, nameMatches, qualifiedNameMatches }) =>
          rank < 4 || nameMatches > 0 || qualifiedNameMatches > 0,
      );
    const exactCandidates = candidates
      .filter(({ rank }) => rank <= 1)
      .sort(
        (left, right) =>
          left.rank - right.rank || compareSymbols(left.symbol, right.symbol),
      )
      .slice(0, limit);
    const weakLimit = Math.max(
      0,
      Math.max(exactCandidates.length, Math.min(limit, WEAK_RESULT_LIMIT)) -
        exactCandidates.length,
    );
    const weakCandidates = selectWeakCandidates(
      candidates.filter(({ rank }) => rank > 1).sort(compareWeakCandidates),
      queryTokens,
      weakLimit,
    );

    return {
      query: normalizedQuery,
      matches: [...exactCandidates, ...weakCandidates].map(toRankedMatch),
    };
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

function scoreCandidate(
  symbol: StoredSymbol,
  queryTokens: readonly string[],
  normalizedQuery: string,
  fullCandidate: FullCandidate | undefined,
): RankedCandidate {
  let nameMatches = 0;
  let boundaryMatches = 0;
  let substringMatches = 0;
  let qualifiedNameMatches = 0;
  let pathMatches = 0;
  const nameTokens: string[] = [];

  for (const token of queryTokens) {
    const nameMatch = matchToken(symbol.name, token);
    const qualifiedNameMatch = matchToken(symbol.qualifiedName, token);
    const fileMatch = matchToken(symbol.filePath, token);

    if (nameMatch > 0) {
      nameMatches += 1;
      boundaryMatches += nameMatch === 2 ? 1 : 0;
      substringMatches += nameMatch === 1 ? 1 : 0;
      nameTokens.push(token);
    } else if (qualifiedNameMatch > 0 && fileMatch === 0) {
      qualifiedNameMatches += 1;
    } else if (fileMatch > 0) {
      pathMatches += 1;
    } else if (qualifiedNameMatch > 0) {
      qualifiedNameMatches += 1;
    }
  }

  return {
    symbol,
    match: fullCandidate?.match ?? "token",
    rank:
      fullCandidate === undefined
        ? 4
        : fullCandidate.rank <= 1 ||
            matchToken(symbol.name, normalizedQuery.toLowerCase()) !== 2
          ? fullCandidate.rank
          : 2,
    nameMatches,
    boundaryMatches,
    substringMatches,
    qualifiedNameMatches,
    pathMatches,
    nameTokens,
  };
}

function matchToken(value: string, token: string): 0 | 1 | 2 {
  const normalizedValue = value.toLowerCase();
  if (!normalizedValue.includes(token)) {
    return 0;
  }

  return tokenizeIdentifier(value).some((part) => part.startsWith(token)) ? 2 : 1;
}

function compareWeakCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
): number {
  return (
    left.rank - right.rank ||
    right.nameMatches - left.nameMatches ||
    right.boundaryMatches - left.boundaryMatches ||
    right.substringMatches - left.substringMatches ||
    right.qualifiedNameMatches - left.qualifiedNameMatches ||
    Number(isTestFile(left.symbol.filePath)) -
      Number(isTestFile(right.symbol.filePath)) ||
    navigationKindRank(left.symbol.kind) - navigationKindRank(right.symbol.kind) ||
    right.pathMatches - left.pathMatches ||
    compareSymbols(left.symbol, right.symbol)
  );
}

function selectWeakCandidates(
  candidates: readonly RankedCandidate[],
  queryTokens: readonly string[],
  limit: number,
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];

  for (const rank of [2, 3, 4]) {
    selected.push(
      ...selectDiverseCandidates(
        candidates.filter((candidate) => candidate.rank === rank),
        queryTokens,
        limit - selected.length,
      ),
    );
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}

function selectDiverseCandidates(
  candidates: readonly RankedCandidate[],
  queryTokens: readonly string[],
  limit: number,
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  const seen = new Set<StoredSymbol>();

  if (queryTokens.length > 1) {
    for (const token of queryTokens) {
      const candidate = candidates.find(
        (item) => !seen.has(item.symbol) && item.nameTokens.includes(token),
      );
      if (candidate !== undefined) {
        selected.push(candidate);
        seen.add(candidate.symbol);
      }
    }
  }

  for (const candidate of candidates) {
    if (selected.length === limit) {
      break;
    }
    if (!seen.has(candidate.symbol)) {
      selected.push(candidate);
      seen.add(candidate.symbol);
    }
  }

  return selected.slice(0, limit);
}

function toRankedMatch(
  candidate: RankedCandidate,
): FindSymbolResult["matches"][number] {
  return { ...toSymbolSummary(candidate.symbol), match: candidate.match };
}

function navigationKindRank(kind: StoredSymbol["kind"]): number {
  switch (kind) {
    case "function":
      return 0;
    case "callable_variable":
      return 1;
    case "class":
      return 2;
    case "method":
      return 3;
    case "interface":
    case "type_alias":
      return 4;
  }
}

function tokenizeIdentifier(value: string): string[] {
  const parts = value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

  return [...new Set(parts)];
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[^/]+$/i.test(
    filePath,
  );
}

function compareSymbols(left: StoredSymbol, right: StoredSymbol): number {
  return (
    compareText(left.filePath, right.filePath) ||
    compareText(left.qualifiedName, right.qualifiedName) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    compareText(left.kind, right.kind) ||
    compareText(left.name, right.name)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
