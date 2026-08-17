import { resolve } from "node:path";
import ts from "typescript";
import type { LoadedProject } from "../project/loader.js";
import type { ExtractedFile, ExtractedImport } from "../records.js";

export function extractImports(
  project: LoadedProject,
  files: readonly ExtractedFile[],
): ExtractedImport[] {
  const canonicalize = ts.sys.useCaseSensitiveFileNames
    ? (fileName: string) => resolve(fileName)
    : (fileName: string) => resolve(fileName).toLowerCase();
  const indexedPaths = new Map(
    project.sourceFiles.map((sourceFile, index) => [
      canonicalize(sourceFile.fileName),
      files[index]?.path,
    ]),
  );
  const resolutionCache = ts.createModuleResolutionCache(
    project.repositoryRoot,
    canonicalize,
    project.program.getCompilerOptions(),
  );
  const imports: ExtractedImport[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.sourceFiles) {
    const sourcePath = indexedPaths.get(canonicalize(sourceFile.fileName));
    if (sourcePath === undefined) {
      continue;
    }

    for (const statement of sourceFile.statements) {
      const moduleSpecifier = getModuleSpecifier(statement);
      if (moduleSpecifier === undefined) {
        continue;
      }

      const resolvedModule = ts.resolveModuleName(
        moduleSpecifier.text,
        sourceFile.fileName,
        project.program.getCompilerOptions(),
        ts.sys,
        resolutionCache,
        undefined,
        project.program.getModeForUsageLocation(sourceFile, moduleSpecifier),
      ).resolvedModule;
      const targetPath =
        resolvedModule === undefined || resolvedModule.isExternalLibraryImport
          ? undefined
          : indexedPaths.get(canonicalize(resolvedModule.resolvedFileName));

      if (targetPath === undefined) {
        continue;
      }

      const key = JSON.stringify([sourcePath, targetPath, moduleSpecifier.text]);
      if (!seen.has(key)) {
        seen.add(key);
        imports.push({
          sourcePath,
          targetPath,
          specifier: moduleSpecifier.text,
        });
      }
    }
  }

  return imports;
}

function getModuleSpecifier(
  statement: ts.Statement,
): ts.StringLiteralLike | undefined {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier;
  }

  return undefined;
}
