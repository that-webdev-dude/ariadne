#!/usr/bin/env node

import { initializeIndex } from "./store/database.js";
import { extractFilesAndSymbols } from "./extractor/symbols.js";
import { loadProject } from "./project/loader.js";

function usage(): never {
  console.error("Usage: ari index <repository-path>");
  process.exit(1);
}

const [command, repositoryPath, ...extraArguments] = process.argv.slice(2);

if (command !== "index" || repositoryPath === undefined || extraArguments.length > 0) {
  usage();
}

try {
  const project = loadProject(repositoryPath);
  const files = extractFilesAndSymbols(project);
  const index = initializeIndex(project.repositoryRoot, files);
  console.log("Ariadne index initialized");
  console.log(`Repository: ${index.repositoryRoot}`);
  console.log(`Database: ${index.databasePath}`);
  console.log(`Files indexed: ${index.fileCount}`);
  console.log(`Symbols indexed: ${index.symbolCount}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
