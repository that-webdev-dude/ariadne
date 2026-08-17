import ts from "typescript";
import type { LoadedProject } from "../project/loader.js";
import {
  symbolReferenceKey,
  type ExtractedCall,
  type SymbolReference,
} from "../records.js";
import type { ProjectSymbolExtraction } from "./symbols.js";

const callableKinds = new Set(["function", "method", "callable_variable"]);

export function extractCalls(
  project: LoadedProject,
  symbols: ProjectSymbolExtraction,
): ExtractedCall[] {
  const calls: ExtractedCall[] = [];
  const seen = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const sourceSymbol = findEnclosingCaller(
        node,
        symbols.referencesByDeclaration,
      );
      const targetSymbol = resolveTarget(node, project, symbols);

      if (sourceSymbol !== undefined && targetSymbol !== undefined) {
        const key = `${symbolReferenceKey(sourceSymbol)}->${symbolReferenceKey(targetSymbol)}`;
        if (!seen.has(key)) {
          seen.add(key);
          calls.push({ sourceSymbol, targetSymbol });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  for (const sourceFile of project.sourceFiles) {
    visit(sourceFile);
  }

  return calls;
}

function findEnclosingCaller(
  call: ts.CallExpression,
  referencesByDeclaration: ReadonlyMap<ts.Node, SymbolReference>,
): SymbolReference | undefined {
  let current: ts.Node | undefined = call.parent;

  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      const reference = referencesByDeclaration.get(current);
      if (reference !== undefined && callableKinds.has(reference.kind)) {
        return reference;
      }
    }

    current = current.parent;
  }

  return undefined;
}

function resolveTarget(
  call: ts.CallExpression,
  project: LoadedProject,
  symbols: ProjectSymbolExtraction,
): SymbolReference | undefined {
  const expression = call.expression;
  if (!ts.isElementAccessExpression(expression)) {
    const symbolLocation = ts.isPropertyAccessExpression(expression)
      ? expression.name
      : expression;
    let targetSymbol = project.checker.getSymbolAtLocation(symbolLocation);

    if (
      targetSymbol?.flags !== undefined &&
      targetSymbol.flags & ts.SymbolFlags.Alias
    ) {
      targetSymbol = project.checker.getAliasedSymbol(targetSymbol);
    }

    const symbolReference =
      targetSymbol === undefined
        ? undefined
        : symbols.referencesBySymbol.get(targetSymbol);
    if (
      symbolReference !== undefined &&
      callableKinds.has(symbolReference.kind)
    ) {
      return symbolReference;
    }
  }

  const signatureDeclaration = project.checker.getResolvedSignature(call)?.declaration;
  const declarationReference =
    signatureDeclaration === undefined
      ? undefined
      : symbols.referencesByDeclaration.get(signatureDeclaration);
  return declarationReference !== undefined && callableKinds.has(declarationReference.kind)
    ? declarationReference
    : undefined;
}
