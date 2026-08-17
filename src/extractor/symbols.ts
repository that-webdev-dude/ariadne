import { relative, sep } from "node:path";
import ts from "typescript";
import type { LoadedProject } from "../project/loader.js";

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

export function extractFilesAndSymbols(
  project: LoadedProject,
): ExtractedFile[] {
  return project.sourceFiles.map((sourceFile) => ({
    path: relative(project.repositoryRoot, sourceFile.fileName).split(sep).join("/"),
    symbols: extractSymbols(sourceFile, project.checker),
  }));
}

function extractSymbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<ts.Symbol>();

  function visit(node: ts.Node): void {
    const kind = getSymbolKind(node, checker);
    const nameNode = getNameNode(node);
    const symbol = nameNode === undefined ? undefined : checker.getSymbolAtLocation(nameNode);

    if (kind !== undefined && symbol !== undefined && !seen.has(symbol)) {
      seen.add(symbol);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

      symbols.push({
        name: symbol.getName(),
        qualifiedName: checker.getFullyQualifiedName(symbol),
        kind,
        startLine: start.line + 1,
        startColumn: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
        signature: getSignature(node, checker),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function getSymbolKind(
  node: ts.Node,
  checker: ts.TypeChecker,
): SymbolKind | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return "function";
  }

  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    return "method";
  }

  if (ts.isClassDeclaration(node) && node.name !== undefined) {
    return "class";
  }

  if (ts.isInterfaceDeclaration(node)) {
    return "interface";
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return "type_alias";
  }

  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    checker.getTypeAtLocation(node.name).getCallSignatures().length > 0
  ) {
    return "callable_variable";
  }

  return undefined;
}

function getNameNode(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableDeclaration(node)
  ) {
    return node.name;
  }

  return undefined;
}

function getSignature(node: ts.Node, checker: ts.TypeChecker): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node)
  ) {
    const signature = checker.getSignatureFromDeclaration(node);
    return signature === undefined
      ? null
      : checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation);
  }

  if (ts.isVariableDeclaration(node)) {
    const signature = checker.getTypeAtLocation(node.name).getCallSignatures()[0];
    return signature === undefined
      ? null
      : checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation);
  }

  return null;
}
