import { relative, sep } from "node:path";
import ts from "typescript";
import type { LoadedProject } from "../project/loader.js";
import type {
  ExtractedFile,
  ExtractedSymbol,
  SymbolKind,
  SymbolReference,
} from "../records.js";

export interface ProjectSymbolExtraction {
  files: readonly ExtractedFile[];
  referencesByDeclaration: ReadonlyMap<ts.Node, SymbolReference>;
  referencesBySymbol: ReadonlyMap<ts.Symbol, SymbolReference>;
}

export function extractFilesAndSymbols(
  project: LoadedProject,
): ExtractedFile[] {
  return [...extractProjectSymbols(project).files];
}

export function extractProjectSymbols(
  project: LoadedProject,
): ProjectSymbolExtraction {
  const files: ExtractedFile[] = [];
  const referencesByDeclaration = new Map<ts.Node, SymbolReference>();
  const referencesBySymbol = new Map<ts.Symbol, SymbolReference>();

  for (const sourceFile of project.sourceFiles) {
    const filePath = relative(project.repositoryRoot, sourceFile.fileName)
      .split(sep)
      .join("/");
    const symbols: ExtractedSymbol[] = [];
    const referencesInFile = new Map<ts.Symbol, SymbolReference>();

    function visit(node: ts.Node): void {
      const kind = getSymbolKind(node, project.checker);
      const nameNode = getNameNode(node);
      const symbol =
        nameNode === undefined
          ? undefined
          : project.checker.getSymbolAtLocation(nameNode);

      if (kind !== undefined && symbol !== undefined) {
        let reference = referencesInFile.get(symbol);

        if (reference === undefined) {
          const start = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          const extractedSymbol: ExtractedSymbol = {
            name: symbol.getName(),
            qualifiedName: project.checker.getFullyQualifiedName(symbol),
            kind,
            startLine: start.line + 1,
            startColumn: start.character + 1,
            endLine: end.line + 1,
            endColumn: end.character + 1,
            signature: getSignature(node, project.checker),
          };

          symbols.push(extractedSymbol);
          reference = {
            filePath,
            name: extractedSymbol.name,
            qualifiedName: extractedSymbol.qualifiedName,
            kind: extractedSymbol.kind,
            startLine: extractedSymbol.startLine,
            startColumn: extractedSymbol.startColumn,
          };
          referencesInFile.set(symbol, reference);
          if (!referencesBySymbol.has(symbol)) {
            referencesBySymbol.set(symbol, reference);
          }
        }

        referencesByDeclaration.set(node, reference);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    files.push({ path: filePath, symbols });
  }

  return { files, referencesByDeclaration, referencesBySymbol };
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
