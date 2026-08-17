#!/usr/bin/env node

import { initializeIndex } from "./store/database.js";

function usage(): never {
  console.error("Usage: ari index <repository-path>");
  process.exit(1);
}

const [command, repositoryPath, ...extraArguments] = process.argv.slice(2);

if (command !== "index" || repositoryPath === undefined || extraArguments.length > 0) {
  usage();
}

try {
  const index = initializeIndex(repositoryPath);
  console.log("Ariadne index initialized");
  console.log(`Repository: ${index.repositoryRoot}`);
  console.log(`Database: ${index.databasePath}`);
  console.log("Files indexed: 0");
  console.log("Symbols indexed: 0");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
