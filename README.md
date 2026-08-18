# Ariadne

Ariadne is an experimental repository index for coding agents.

Its purpose is to test a narrow hypothesis:

> A compiler-derived structural index can help a coding agent navigate a large TypeScript codebase while loading materially less source code into context.

Ariadne is not intended to understand or summarize an entire codebase. It provides compact, deterministic navigation facts so an agent can locate relevant source before reading it.

## P0 Goal

Build the smallest end-to-end prototype that can:

1. index one TypeScript repository;
2. extract files, symbols, imports, and direct compiler-resolved calls;
3. persist the resulting structural index in SQLite;
4. expose compact navigation queries;
5. expose those queries through MCP;
6. measure whether Ariadne reduces source-code consumption during a debugging task.

The P0 experiment is successful only if the index improves agent navigation in practice.

## Architecture

```text
TypeScript repository
        |
        v
TypeScript Compiler API
        |
        v
Structural Extractor
        |
        v
SQLite ARI Store
        |
        v
Query Service
        |
        v
MCP Server
        |
        v
Coding Agent
```

Ariadne itself is deterministic in P0.

No LLM or agent participates in index generation.

## P0 Data Model

P0 models only three structural concepts.

### File

Represents an indexed TypeScript source file.

### Symbol

Represents a named navigation target such as:

- function;
- method;
- class;
- interface;
- type alias;
- named callable variable.

### Relationship

P0 supports structural relationships only.

Initial relationships:

- direct symbol `CALLS`;
- file imports.

The index does not attempt to represent complete runtime behaviour.

## Initial Queries

The P0 query service exposes five navigation operations.

### `repo_overview`

Returns compact repository orientation including file count, symbol count, top-level source paths, and basic entry-point candidates.

### `find_symbol`

Finds symbols by name or qualified name.

### `describe_symbol`

Returns a compact structural projection of a symbol including:

- location;
- kind;
- signature;
- direct calls;
- direct callers.

### `dependencies`

Returns direct outgoing call relationships for a symbol.

P0 traversal depth is exactly one hop.

### `dependents`

Returns direct incoming call relationships for a symbol.

P0 traversal depth is exactly one hop.

## Scope Boundaries

P0 supports:

- one local TypeScript repository;
- `tsconfig.json`-based project loading;
- the TypeScript Compiler API;
- compiler-resolved named symbols;
- direct call relationships where the target can be resolved confidently;
- import relationships;
- SQLite persistence;
- compact agent-facing query projections;
- MCP exposure of the five initial queries;
- explicit full re-indexing.

Correctness is preferred over graph completeness.

If a relationship cannot be resolved confidently, omit it.

## Explicitly Out of Scope

Do not add any of the following to P0:

- LLM-generated summaries;
- semantic codebase descriptions;
- embeddings;
- vector databases;
- RAG;
- domain concepts;
- logical module inference;
- runtime flows;
- task-specific subgraphs;
- state/data-flow analysis;
- `READS`, `WRITES`, or `MUTATES` relationships;
- React-specific analysis;
- React Query analysis;
- Spring or Java support;
- runtime instrumentation;
- incremental indexing;
- file watching;
- invalidation propagation;
- working-tree overlays;
- branch-aware index caches;
- rename tracking;
- persistent symbol identity across refactors;
- confidence scoring;
- semantic provenance;
- graph databases;
- arbitrary graph-query languages;
- multi-hop dependency traversal;
- autonomous debugging orchestration.

These may become future experiments only after P0 demonstrates measurable value.

## Implementation Sequence

Development should proceed vertically.

### Phase 1 — Repository Skeleton and Storage

Establish:

- TypeScript project;
- CLI entry point;
- SQLite database;
- schema creation;
- minimal tests.

The project must be executable before moving on.

### Phase 2 — TypeScript Project Loading and Symbol Extraction

Use the TypeScript Compiler API to:

- load `tsconfig.json`;
- create a `Program`;
- obtain a `TypeChecker`;
- enumerate source files;
- extract supported named symbols;
- persist files and symbols.

Provide a CLI command that proves indexing works.

### Phase 3 — Structural Relationships

Extract:

- file imports;
- direct call relationships where the TypeChecker can resolve the target.

Persist these relationships and verify them against controlled fixtures.

### Phase 4 — Query Service

Implement:

- `repo_overview`;
- `find_symbol`;
- `describe_symbol`;
- `dependencies`;
- `dependents`.

Responses must be compact and bounded.

### Phase 5 — MCP Adapter

Expose the five query-service operations as MCP tools.

The MCP layer must contain no repository-analysis logic.

### Phase 6 — Benchmark

Run the same debugging task twice:

1. coding agent with normal repository tools;
2. same coding agent with Ariadne available.

Compare navigation cost and diagnosis quality.

## P0 Acceptance Criteria

P0 is complete when all of the following are true.

### Indexing

- Ariadne can load a real TypeScript repository from `tsconfig.json`.
- It indexes source files.
- It indexes supported named symbols.
- It resolves and stores file imports.
- It resolves and stores direct calls where the TypeChecker provides a reliable target.
- Re-running the explicit index command produces a fresh usable database.

### Queries

All five queries work against the SQLite index:

- `repo_overview`;
- `find_symbol`;
- `describe_symbol`;
- `dependencies`;
- `dependents`.

Query responses are bounded and do not dump raw database state.

### MCP

A coding agent can call all five queries through MCP.

### Correctness

Controlled test fixtures verify:

- symbol extraction;
- qualified symbol identity;
- direct call extraction;
- incoming caller lookup;
- import extraction.

Unsupported or unresolved calls are omitted rather than guessed.

### Benchmark

A repeatable debugging benchmark exists.

Measure at minimum:

- number of source files opened;
- source lines or source tokens loaded;
- repository-search operations;
- navigation/tool calls;
- correctness of the final diagnosis.

The main success signal is a material reduction in source-code consumption without reducing debugging correctness.

A useful initial target is:

> At least 40% fewer source tokens loaded than the baseline agent on the benchmark task.

This threshold is experimental, not a product requirement.

## Design Principles

### Navigation before comprehension

Ariadne should help an agent determine what code to read, not attempt to explain all code in advance.

### Deterministic first

If the compiler can provide a fact, obtain it from the compiler.

### Progressive disclosure

Queries should return only enough information for the agent to decide the next navigation step.

### Incomplete truth over fabricated completeness

Missing relationships are acceptable.

Incorrect relationships are not.

### Validate before expanding

Do not add semantic or advanced indexing features until P0 demonstrates that the structural index materially improves navigation.

## Current implementation

The repository contains the Phase 1 storage bootstrap, Phase 2 TypeScript
project loading and named-symbol extraction, Phase 3 static file imports and
direct compiler-resolved call relationships, and the Phase 4 read-only query
service. Phase 5 exposes that service through a thin read-only MCP adapter.
Phase 6 adds an experiment-only A/B benchmark harness under
`benchmark/phase6`; it does not participate in indexing or query execution.

## Indexing a TypeScript project

Requires Node.js 22.13 or newer.

```sh
npm install
npm run typecheck
npm test
npm run build
npm run ari -- index /path/to/typescript-repository
```

The `index` command loads the repository's root `tsconfig.json`, then creates or
replaces `.ari/index.sqlite` with the project's files and supported named
symbols, local static imports, and direct compiler-resolved calls.

## Querying an index

Open an existing index from its repository root. Queries never rebuild or
modify the index.

```ts
import { openQueryService } from "./dist/src/query/service.js";

const queries = openQueryService("/path/to/typescript-repository");

try {
  console.log(queries.repoOverview());
  console.log(queries.findSymbol("render"));
} finally {
  queries.close();
}
```

The service provides `repoOverview`, `findSymbol`, `describeSymbol`,
`dependencies`, and `dependents`. Symbol lookup results contain the stable ID
required by the exact-symbol queries.

## Running the MCP server

Build the project, then configure an MCP client to launch the stdio server with
the indexed repository root as its only argument:

```json
{
  "command": "node",
  "args": [
    "/path/to/ariadne/dist/src/mcp.js",
    "/path/to/indexed-typescript-repository"
  ]
}
```

The server exposes exactly `ari.repo_overview`, `ari.find_symbol`,
`ari.describe_symbol`, `ari.dependencies`, and `ari.dependents`. Each tool is
read-only and returns the corresponding Phase 4 projection as JSON text.

## Running the Phase 6 harness

The focused harness test and sample report are available through:

```sh
npm run benchmark:test
npm run benchmark -- benchmark/phase6/fixtures/sample-results.json
```

See `benchmark/phase6/README.md` for the frozen A/B protocol and accounting rules.
