export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type_alias"
  | "callable_variable";

export interface ExtractedSymbol {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  signature: string | null;
}

export interface ExtractedFile {
  path: string;
  symbols: readonly ExtractedSymbol[];
}

export interface SymbolReference {
  filePath: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  startColumn: number;
}

export interface ExtractedImport {
  sourcePath: string;
  targetPath: string;
  specifier: string;
}

export interface ExtractedCall {
  sourceSymbol: SymbolReference;
  targetSymbol: SymbolReference;
}

export interface ExtractedIndex {
  files: readonly ExtractedFile[];
  imports: readonly ExtractedImport[];
  calls: readonly ExtractedCall[];
}

export function symbolReferenceKey(reference: SymbolReference): string {
  return JSON.stringify([
    reference.filePath,
    reference.qualifiedName,
    reference.kind,
    reference.startLine,
    reference.startColumn,
  ]);
}
