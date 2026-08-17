#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAriadneMcpServer } from "./mcp/server.js";

const [repositoryPath, ...extraArguments] = process.argv.slice(2);

if (repositoryPath === undefined || extraArguments.length > 0) {
  console.error("Usage: ari-mcp <repository-path>");
  process.exit(1);
}

serveStdio(() => createAriadneMcpServer(repositoryPath), {
  onerror: (error) => console.error(error.message),
});
