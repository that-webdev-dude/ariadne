import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { extractProject } from "../src/extractor/project.js";
import { createAriadneMcpServer } from "../src/mcp/server.js";
import {
  openQueryService,
  type AriadneQueryService,
} from "../src/query/service.js";
import { initializeIndex } from "../src/store/database.js";
import { loadProject } from "../src/project/loader.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../tests/fixtures/query-project",
);
const toolNames = [
  "ari.dependencies",
  "ari.dependents",
  "ari.describe_symbol",
  "ari.find_symbol",
  "ari.repo_overview",
];

let repositoryPath: string;
let databasePath: string;
let databaseModifiedAt: number;
let server: McpServer;
let client: Client;
let directQueries: AriadneQueryService;

test.before(async () => {
  repositoryPath = mkdtempSync(join(tmpdir(), "ariadne-mcp-"));
  cpSync(fixturePath, repositoryPath, { recursive: true });
  databasePath = initializeIndex(
    repositoryPath,
    extractProject(loadProject(repositoryPath)),
  ).databasePath;
  databaseModifiedAt = statSync(databasePath).mtimeMs;
  directQueries = openQueryService(repositoryPath);

  server = createAriadneMcpServer(repositoryPath);
  client = new Client({ name: "ariadne-test", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

test.after(async () => {
  directQueries.close();
  await client.close();
  await server.close();
  assert.equal(statSync(databasePath).mtimeMs, databaseModifiedAt);
  rmSync(repositoryPath, { recursive: true, force: true });
});

test("MCP exposes exactly five read-only Ariadne tools", async () => {
  const tools = (await client.listTools()).tools;

  assert.deepEqual(
    tools.map(({ name }) => name).sort(),
    toolNames,
  );
  assert.ok(tools.every(({ inputSchema }) => inputSchema.type === "object"));
  assert.ok(
    tools.every(
      ({ annotations }) =>
        annotations?.readOnlyHint === true &&
        annotations.destructiveHint === false &&
        annotations.idempotentHint === true &&
        annotations.openWorldHint === false,
    ),
  );
  const findSymbol = tools.find(({ name }) => name === "ari.find_symbol");
  assert.match(findSymbol?.description ?? "", /lexical/i);
  assert.match(findSymbol?.description ?? "", /case-insensitive/i);
  assert.match(findSymbol?.description ?? "", /identifier-like terms/i);
  assert.match(findSymbol?.description ?? "", /ari\.describe_symbol/);
  assert.match(findSymbol?.description ?? "", /not semantic search/i);
});

test("all MCP tools return the existing Phase 4 projections", async () => {
  const overview = await callJson("ari.repo_overview", {});
  assert.deepEqual(overview, directQueries.repoOverview());

  const found = directQueries.findSymbol("a");
  assert.deepEqual(await callJson("ari.find_symbol", { query: "a" }), found);
  assert.ok(found.matches.every((match) => !("qualifiedName" in match)));
  assert.deepEqual(
    await callJson("ari.find_symbol", { query: "scene manager", limit: 3 }),
    directQueries.findSymbol("scene manager", { limit: 3 }),
  );
  const a = found.matches[0];
  const d = directQueries.findSymbol("d").matches[0];
  assert.ok(a);
  assert.ok(d);

  const described = directQueries.describeSymbol(a.id);
  assert.ok(described);
  assert.equal(typeof described.symbol.qualifiedName, "string");
  assert.ok(described.calls.every((symbol) => !("qualifiedName" in symbol)));
  assert.deepEqual(
    await callJson("ari.describe_symbol", { symbolId: a.id }),
    described,
  );
  assert.deepEqual(
    await callJson("ari.dependencies", { symbolId: a.id, limit: 1 }),
    directQueries.dependencies(a.id, { limit: 1 }),
  );
  assert.deepEqual(
    await callJson("ari.dependents", { symbolId: d.id, limit: 1 }),
    directQueries.dependents(d.id, { limit: 1 }),
  );
});

test("MCP schemas reject malformed arguments", async () => {
  const result = await client.callTool({
    name: "ari.find_symbol",
    arguments: { query: " ", limit: 0 },
  });

  assert.equal(result.isError, true);
  assert.match(toolText(result), /invalid|query|limit/i);
});

test("MCP translates a missing index into a clear tool error", async () => {
  const missingRepository = mkdtempSync(join(tmpdir(), "ariadne-mcp-missing-"));
  const missingServer = createAriadneMcpServer(missingRepository);
  const missingClient = new Client({ name: "ariadne-test", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await missingServer.connect(serverTransport);
    await missingClient.connect(clientTransport);
    const result = await missingClient.callTool({
      name: "ari.repo_overview",
      arguments: {},
    });

    assert.equal(result.isError, true);
    assert.match(toolText(result), /Ariadne index not found/);
  } finally {
    await missingClient.close();
    await missingServer.close();
    rmSync(missingRepository, { recursive: true, force: true });
  }
});

async function callJson(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(result.isError, true, toolText(result));
  return JSON.parse(toolText(result)) as unknown;
}

function toolText(result: CallToolResult): string {
  const content = result.content[0];
  if (content?.type !== "text") {
    throw new Error("Expected an MCP text result");
  }

  return content.text;
}
