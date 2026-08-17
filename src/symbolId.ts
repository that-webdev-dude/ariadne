import type { SymbolKind } from "./records.js";

export interface SymbolIdentity {
  filePath: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  startColumn: number;
}

const symbolKinds = new Set<SymbolKind>([
  "function",
  "method",
  "class",
  "interface",
  "type_alias",
  "callable_variable",
]);

export function createSymbolId(identity: SymbolIdentity): string {
  const payload = JSON.stringify([
    identity.filePath,
    identity.qualifiedName,
    identity.kind,
    identity.startLine,
    identity.startColumn,
  ]);

  return `sym_${Buffer.from(payload, "utf8").toString("base64url")}`;
}

export function parseSymbolId(id: string): SymbolIdentity | null {
  if (!id.startsWith("sym_")) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(
      Buffer.from(id.slice(4), "base64url").toString("utf8"),
    );

    if (
      !Array.isArray(value) ||
      value.length !== 5 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string" ||
      !symbolKinds.has(value[2] as SymbolKind) ||
      !Number.isInteger(value[3]) ||
      !Number.isInteger(value[4])
    ) {
      return null;
    }

    return {
      filePath: value[0],
      qualifiedName: value[1],
      kind: value[2] as SymbolKind,
      startLine: value[3] as number,
      startColumn: value[4] as number,
    };
  } catch {
    return null;
  }
}
