import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  MAX_QUERY_LIMIT,
  openQueryService,
  type AriadneQueryService,
} from "../query/service.js";
import { AriadneIndexNotFoundError } from "../store/repository.js";

const limit = z.number().int().positive().max(MAX_QUERY_LIMIT).optional();
const symbolId = z.string().trim().min(1);
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createAriadneMcpServer(repositoryPath: string): McpServer {
  const server = new McpServer({ name: "ariadne", version: "0.1.0" });

  server.registerTool(
    "ari.repo_overview",
    {
      description: "Return the compact overview of the indexed repository.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    () => runQuery(repositoryPath, (queries) => queries.repoOverview()),
  );

  server.registerTool(
    "ari.find_symbol",
    {
      description:
        "Find indexed symbols with lexical, case-insensitive matching. Natural-language phrases are split into identifier-like terms. Use returned symbol IDs with ari.describe_symbol. This is not semantic search.",
      inputSchema: z.object({
        query: z.string().trim().min(1),
        limit,
      }),
      annotations: readOnlyAnnotations,
    },
    ({ query, limit }) =>
      runQuery(repositoryPath, (queries) =>
        queries.findSymbol(query, limit === undefined ? {} : { limit }),
      ),
  );

  server.registerTool(
    "ari.describe_symbol",
    {
      description: "Describe one exact indexed symbol and its direct calls.",
      inputSchema: z.object({ symbolId, limit }),
      annotations: readOnlyAnnotations,
    },
    ({ symbolId, limit }) =>
      runQuery(repositoryPath, (queries) =>
        queries.describeSymbol(symbolId, limit === undefined ? {} : { limit }),
      ),
  );

  server.registerTool(
    "ari.dependencies",
    {
      description: "Return symbols directly called by one exact symbol.",
      inputSchema: z.object({ symbolId, limit }),
      annotations: readOnlyAnnotations,
    },
    ({ symbolId, limit }) =>
      runQuery(repositoryPath, (queries) =>
        queries.dependencies(symbolId, limit === undefined ? {} : { limit }),
      ),
  );

  server.registerTool(
    "ari.dependents",
    {
      description: "Return symbols that directly call one exact symbol.",
      inputSchema: z.object({ symbolId, limit }),
      annotations: readOnlyAnnotations,
    },
    ({ symbolId, limit }) =>
      runQuery(repositoryPath, (queries) =>
        queries.dependents(symbolId, limit === undefined ? {} : { limit }),
      ),
  );

  return server;
}

function runQuery(
  repositoryPath: string,
  operation: (queries: AriadneQueryService) => unknown,
): CallToolResult {
  try {
    const queries = openQueryService(repositoryPath);

    try {
      return jsonResult(operation(queries));
    } finally {
      queries.close();
    }
  } catch (error) {
    if (error instanceof AriadneIndexNotFoundError) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }

    throw error;
  }
}

function jsonResult(result: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result) ?? "null",
      },
    ],
  };
}
