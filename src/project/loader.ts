import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

export interface LoadedProject {
  repositoryRoot: string;
  configPath: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: readonly ts.SourceFile[];
}

export function loadProject(repositoryPath: string): LoadedProject {
  const repositoryRoot = resolve(repositoryPath);

  if (!statSync(repositoryRoot).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repositoryRoot}`);
  }

  const configPath = join(repositoryRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error !== undefined) {
    throw new Error(formatDiagnostics([configFile.error]));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  );

  if (parsedConfig.errors.length > 0) {
    throw new Error(formatDiagnostics(parsedConfig.errors));
  }

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
    ...(parsedConfig.projectReferences === undefined
      ? {}
      : { projectReferences: parsedConfig.projectReferences }),
  });

  return {
    repositoryRoot,
    configPath,
    program,
    checker: program.getTypeChecker(),
    sourceFiles: program
      .getSourceFiles()
      .filter(
        (sourceFile) =>
          !program.isSourceFileDefaultLibrary(sourceFile) &&
          !program.isSourceFileFromExternalLibrary(sourceFile),
      )
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  });
}
