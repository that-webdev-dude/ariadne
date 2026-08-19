import { posix, win32 } from "node:path";
import type { SymbolKind } from "./records.js";

export interface SymbolIdentity {
  filePath: string;
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
  if (!isRepositoryRelativePath(identity.filePath)) {
    throw new Error("Symbol ID file path must be repository-relative");
  }

  const payload = JSON.stringify([
    identity.filePath,
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
      value.length !== 4 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string" ||
      !symbolKinds.has(value[1] as SymbolKind) ||
      !Number.isInteger(value[2]) ||
      (value[2] as number) < 1 ||
      !Number.isInteger(value[3]) ||
      (value[3] as number) < 1 ||
      !isRepositoryRelativePath(value[0])
    ) {
      return null;
    }

    return {
      filePath: value[0],
      kind: value[1] as SymbolKind,
      startLine: value[2] as number,
      startColumn: value[3] as number,
    };
  } catch {
    return null;
  }
}

function isRepositoryRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !posix.isAbsolute(filePath) &&
    !win32.isAbsolute(filePath)
  );
}
