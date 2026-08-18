import type { SymbolKind } from "../records.js";

export interface QueryLimitOptions {
  limit?: number;
}

export interface SymbolSummary {
  id: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  file: string;
  line: number;
}

export interface RepoOverview {
  repositoryRoot: string;
  indexedAt: string | null;
  indexerVersion: string | null;
  counts: {
    files: number;
    symbols: number;
    imports: number;
    calls: number;
  };
  topLevelPaths: string[];
  entryCandidates: SymbolSummary[];
}

export type SymbolMatchKind =
  | "exact_qualified"
  | "exact_name"
  | "suffix"
  | "prefix"
  | "substring"
  | "token";

export interface SymbolMatch extends SymbolSummary {
  match: SymbolMatchKind;
}

export interface FindSymbolResult {
  query: string;
  matches: SymbolMatch[];
}

export interface SymbolDescription {
  symbol: SymbolSummary & {
    signature: string | null;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  calls: SymbolSummary[];
  calledBy: SymbolSummary[];
  callsTruncated: boolean;
  calledByTruncated: boolean;
}

export interface DependencyResult {
  symbol: SymbolSummary;
  dependencies: SymbolSummary[];
  truncated: boolean;
}

export interface DependentResult {
  symbol: SymbolSummary;
  dependents: SymbolSummary[];
  truncated: boolean;
}
