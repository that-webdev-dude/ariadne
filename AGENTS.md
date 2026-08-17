# AGENTS.md

## Project

This repository contains **Ariadne P0**, an experimental structural repository index for coding agents.

The prototype exists to answer one question:

> Can compiler-derived navigation metadata reduce the amount of source code a coding agent needs to inspect while debugging a TypeScript repository?

Preserve that experimental boundary.

## Working Principle

Ariadne owns deterministic repository navigation facts.

The coding agent consuming Ariadne owns interpretation, debugging, and hypothesis generation.

Do not turn Ariadne P0 into an autonomous code-understanding system.

## P0 Scope

Implement only:

- TypeScript repositories;
- `tsconfig.json` project loading;
- TypeScript Compiler API integration;
- indexed source files;
- named symbols;
- file imports;
- compiler-resolved direct call relationships;
- SQLite persistence;
- five compact query projections;
- MCP exposure;
- explicit full rebuild indexing;
- benchmark instrumentation.

Supported symbol categories should initially be limited to practical navigation targets:

- function declarations;
- methods;
- classes;
- interfaces;
- type aliases;
- named callable variables.

Do not index every AST node or local anonymous function.

## Five P0 Queries

The complete P0 navigation surface is:

1. `repo_overview`
2. `find_symbol`
3. `describe_symbol`
4. `dependencies`
5. `dependents`

Dependency traversal is one hop only.

Do not add generic graph traversal unless explicitly requested.

## Prohibited P0 Features

Do not implement or introduce:

- LLM calls;
- semantic summaries;
- semantic module inference;
- concepts or ontologies;
- embeddings;
- vector databases;
- semantic search;
- RAG;
- runtime flows;
- task-specific subgraphs;
- autonomous debugging;
- data-flow analysis;
- state-flow analysis;
- `READS`;
- `WRITES`;
- `MUTATES`;
- React-specific indexing;
- hook-specific indexing;
- React Context modelling;
- React Query analysis;
- Java;
- Spring;
- runtime instrumentation;
- incremental indexing;
- file watchers;
- invalidation engines;
- working-tree overlays;
- Git branch index caches;
- history-aware indexing;
- rename tracking;
- persistent identities across refactors;
- confidence models;
- semantic provenance;
- graph databases;
- Neo4j;
- generic graph abstractions;
- arbitrary SQL or graph-query MCP tools;
- multi-hop graph traversal.

If implementation pressure appears to require one of these, stop and solve the current P0 requirement more simply.

## Architectural Boundaries

Keep the implementation separated into these responsibilities.

### Project Loader

Owns TypeScript project loading.

Responsibilities:

- resolve `tsconfig.json`;
- read compiler configuration;
- create `Program`;
- provide `TypeChecker`;
- expose source files.

Must not depend on SQLite or MCP.

### Extractor

Owns conversion from TypeScript compiler structures into Ariadne structural records.

Eventually extracts:

- files;
- symbols;
- imports;
- calls.

Must not expose MCP tools.

### Store

Owns SQLite.

Responsibilities:

- schema;
- migrations/schema initialization;
- inserts;
- transactions;
- indexed reads.

Must not depend on the TypeScript Compiler API.

### Query Service

Owns compact agent-facing projections.

It converts stored facts into bounded responses.

It must not expose raw SQL results.

### MCP Adapter

Owns protocol exposure only.

Flow:

```text
MCP request
    ->
argument validation
    ->
query service
    ->
compact response
```

Do not place extraction, graph reasoning, or database logic directly in MCP handlers.

## Implementation Sequence

Follow this order unless explicitly instructed otherwise.

### 1. Skeleton and SQLite

Create an executable project with storage initialization.

### 2. TypeScript project loader

Load a repository correctly from `tsconfig.json`.

### 3. File and symbol extraction

Populate the index with deterministic structural entities.

### 4. Import and call extraction

Add compiler-resolved relationships.

### 5. Query service

Implement the five P0 queries.

### 6. MCP

Expose the query service.

### 7. Benchmark

Evaluate Ariadne against normal coding-agent navigation.

Do not jump ahead.

## Engineering Rules

Prefer simple explicit code over generalized infrastructure.

Avoid speculative abstractions.

Do not create generic types such as:

- `KnowledgeEntity`;
- `GraphProvider`;
- `NavigationStrategy`;
- `IndexerFactory`;

unless a concrete repeated requirement already exists.

P0 is small enough that direct domain-specific code is preferable.

Use TypeScript's own compiler semantics rather than recreating parsing or resolution manually.

When compiler resolution is uncertain or unavailable, omit the relationship.

Never manufacture a call edge from naming similarity alone.

Keep query responses small.

Any potentially unbounded result must have a limit.

Do not optimize indexing performance before measuring a real problem.

A full database rebuild is expected in P0.

## Initial SQLite Model

The initial database contains:

- `metadata`;
- `files`;
- `symbols`;
- `imports`;
- `relationships`.

Relationships initially represent only direct symbol calls.

Do not broaden the relationship ontology during the first implementation tasks.

## Definition of Correctness

Ariadne does not need to produce a complete runtime call graph.

It does need to avoid presenting guesses as compiler-resolved facts.

For P0:

> High precision is more important than high recall.

A missing edge is preferable to a false edge.

## Testing Expectations

Use small controlled TypeScript fixtures to test extraction.

Fixtures should cover at least:

- top-level functions;
- class methods;
- exported symbols;
- named arrow-function variables;
- calls within one file;
- calls across files;
- import aliases;
- unresolved/dynamic calls that must not produce fabricated edges.

Add focused tests as each extractor capability is introduced.

Do not build a giant test fixture before the corresponding feature exists.

## First Codex Task

Implement **Phase 1 only: repository skeleton and SQLite storage bootstrap**.

### Objective

After this task, the repository must contain a runnable TypeScript CLI that can initialize a valid empty Ariadne SQLite index.

Do not implement TypeScript source indexing yet.

### Required Work

1. Bootstrap the project as a Node.js TypeScript application.

2. Establish a minimal source structure compatible with the intended boundaries:

```text
src/
  cli.ts
  store/
    schema.ts
    database.ts
```

Do not create empty directories for future components unless they are already needed.

3. Add SQLite support using a straightforward Node-compatible SQLite library.

Choose the simplest stable library appropriate for a local CLI prototype.

Do not introduce an ORM.

4. Implement schema initialization for:

```text
metadata
files
symbols
imports
relationships
```

Use foreign keys where appropriate.

Add indexes required for symbol-name lookup and incoming/outgoing relationship lookup.

5. Implement a CLI command equivalent to:

```text
ari index <repository-path>
```

For this first task, the command does not inspect TypeScript source.

It should:

- validate that the path exists;
- create `.ari/` under the target repository;
- create or replace `.ari/index.sqlite`;
- initialize the schema;
- write basic metadata including:
  - schema version;
  - repository root;
  - index timestamp;
  - Ariadne/indexer version where available;
- print a concise success message.

Example behaviour:

```text
Ariadne index initialized
Repository: /path/to/repository
Database: /path/to/repository/.ari/index.sqlite
Files indexed: 0
Symbols indexed: 0
```

6. Add tests that verify:

- schema initialization succeeds;
- all expected tables exist;
- required indexes exist;
- the CLI creates the database at the expected location;
- rerunning the command replaces or cleanly recreates the P0 index.

7. Add only the documentation needed to run the command and tests.

### Acceptance Criteria

The task is complete only when:

- dependencies install successfully;
- TypeScript compiles cleanly;
- tests pass;
- the CLI executes successfully against a temporary repository directory;
- `.ari/index.sqlite` is created;
- all five expected tables exist;
- no TypeScript Compiler API indexing has been implemented;
- none of the prohibited P0 features have been introduced.

### Before Finishing

Run the project's:

- type check;
- tests;
- a real CLI smoke test against a temporary directory.

Report:

1. files added or changed;
2. commands run;
3. test results;
4. any implementation decisions that materially affect the next task.

Do not begin Phase 2.
