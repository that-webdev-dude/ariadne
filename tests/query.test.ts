import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { extractProject } from "../src/extractor/project.js";
import {
  type AriadneQueryService,
  openQueryService,
} from "../src/query/service.js";
import { createSymbolId } from "../src/symbolId.js";
import { initializeIndex, INDEXER_VERSION } from "../src/store/database.js";
import {
  AriadneIndexNotFoundError,
  AriadneRepository,
} from "../src/store/repository.js";
import { loadProject } from "../src/project/loader.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../tests/fixtures/query-project",
);

let repositoryPath: string;
let databasePath: string;
let databaseModifiedAt: number;
let service: AriadneQueryService;

test.before(() => {
  repositoryPath = mkdtempSync(join(tmpdir(), "ariadne-query-"));
  cpSync(fixturePath, repositoryPath, { recursive: true });
  databasePath = initializeIndex(
    repositoryPath,
    extractProject(loadProject(repositoryPath)),
  ).databasePath;
  databaseModifiedAt = statSync(databasePath).mtimeMs;
  service = openQueryService(repositoryPath);
});

test.after(() => {
  service.close();
  assert.equal(statSync(databasePath).mtimeMs, databaseModifiedAt);
  rmSync(repositoryPath, { recursive: true, force: true });
});

test("repository reads metadata, aggregates, symbols, and direct relationships", () => {
  const repository = AriadneRepository.open(repositoryPath);

  try {
    assert.deepEqual(repository.getMetadata(), {
      repositoryRoot: resolve(repositoryPath),
      indexedAt: repository.getMetadata().indexedAt,
      indexerVersion: INDEXER_VERSION,
    });
    assert.equal(typeof repository.getMetadata().indexedAt, "string");
    assert.deepEqual(repository.getCounts(), {
      files: 2,
      symbols: 10,
      imports: 1,
      calls: 5,
    });
    assert.deepEqual(repository.getTopLevelPaths(20), ["src"]);
    assert.deepEqual(
      repository.getEntryCandidates(10).map(({ name }) => name),
      ["a", "caller", "greet", "otherCaller"],
    );

    const a = repository.searchSymbols("a", "exactName", 10)[0];
    assert.ok(a);
    const aId = createSymbolId({
      filePath: a.filePath,
      qualifiedName: a.qualifiedName,
      kind: a.kind,
      startLine: a.startLine,
      startColumn: a.startColumn,
    });
    assert.equal(repository.getSymbolById(aId)?.name, "a");
    assert.deepEqual(
      repository.getOutgoingCalls(aId, 10).symbols.map(({ name }) => name),
      ["b", "d"],
    );
  } finally {
    repository.close();
  }
});

test("repoOverview returns bounded deterministic orientation", () => {
  const first = service.repoOverview();
  const second = service.repoOverview();

  assert.equal(first.repositoryRoot, resolve(repositoryPath));
  assert.equal(typeof first.indexedAt, "string");
  assert.equal(first.indexerVersion, INDEXER_VERSION);
  assert.deepEqual(first.counts, {
    files: 2,
    symbols: 10,
    imports: 1,
    calls: 5,
  });
  assert.deepEqual(first.topLevelPaths, ["src"]);
  assert.deepEqual(
    first.entryCandidates.map(({ name }) => name),
    ["a", "caller", "greet", "otherCaller"],
  );
  assert.ok(first.entryCandidates.length <= 10);
  assert.deepEqual(first.entryCandidates, second.entryCandidates);
});

test("findSymbol ranks lexical matches and preserves ambiguous symbols", () => {
  const greet = service.findSymbol("greet");

  assert.equal(greet.matches.length, 3);
  assert.ok(greet.matches.every(({ match }) => match === "exact_name"));
  assert.equal(new Set(greet.matches.map(({ id }) => id)).size, 3);

  const mainGreet = greet.matches.find(({ file }) => file === "src/main.ts");
  assert.ok(mainGreet);
  assert.equal(
    service.findSymbol(mainGreet.qualifiedName).matches[0]?.match,
    "exact_qualified",
  );
  assert.deepEqual(
    service.findSymbol("Greeter.greet").matches.map(({ kind, match }) => [
      kind,
      match,
    ]),
    [["method", "suffix"]],
  );
  assert.deepEqual(
    service.findSymbol("call").matches.map(({ name, match }) => [name, match]),
    [["caller", "prefix"]],
  );
  assert.deepEqual(
    service.findSymbol("ther").matches.map(({ name, match }) => [name, match]),
    [["otherCaller", "substring"]],
  );
  assert.equal(service.findSymbol("greet", { limit: 1 }).matches.length, 1);
  assert.deepEqual(service.findSymbol("doesNotExist"), {
    query: "doesNotExist",
    matches: [],
  });
});

test("describeSymbol returns exact one-hop details without database IDs", () => {
  const a = requiredMatch("a");
  const description = service.describeSymbol(a.id);

  assert.ok(description);
  assert.equal(description.symbol.id, a.id);
  assert.equal(description.symbol.signature, "(): number");
  assert.equal(description.symbol.startLine, 3);
  assert.equal(description.symbol.startColumn, 1);
  assert.ok(description.symbol.endLine >= description.symbol.startLine);
  assert.deepEqual(description.calls.map(({ name }) => name), ["b", "d"]);
  assert.deepEqual(description.calledBy.map(({ name }) => name), ["caller"]);
  assert.equal(description.calls.some(({ name }) => name === "c"), false);
  assert.equal(description.callsTruncated, false);
  assert.equal(description.calledByTruncated, false);
  assert.equal(JSON.stringify(description).includes("file_id"), false);
  assert.equal(JSON.stringify(description).includes("fileId"), false);
  assert.equal(service.describeSymbol("sym_not-valid"), null);
});

test("dependencies are deterministic, bounded, truncated, and one hop", () => {
  const a = requiredMatch("a");
  const full = service.dependencies(a.id);
  const bounded = service.dependencies(a.id, { limit: 1 });
  const caller = service.dependencies(requiredMatch("caller").id);

  assert.deepEqual(full?.dependencies.map(({ name }) => name), ["b", "d"]);
  assert.equal(full?.truncated, false);
  assert.deepEqual(bounded?.dependencies.map(({ name }) => name), ["b"]);
  assert.equal(bounded?.truncated, true);
  assert.deepEqual(caller?.dependencies.map(({ name }) => name), ["a"]);
  assert.equal(caller?.dependencies.some(({ name }) => name === "b"), false);
  assert.equal(service.dependencies("unknown"), null);
});

test("dependents are deterministic, bounded, truncated, and one hop", () => {
  const d = requiredMatch("d");
  const full = service.dependents(d.id);
  const bounded = service.dependents(d.id, { limit: 1 });
  const c = service.dependents(requiredMatch("c").id);

  assert.deepEqual(full?.dependents.map(({ name }) => name), ["a", "otherCaller"]);
  assert.equal(full?.truncated, false);
  assert.deepEqual(bounded?.dependents.map(({ name }) => name), ["a"]);
  assert.equal(bounded?.truncated, true);
  assert.deepEqual(c?.dependents.map(({ name }) => name), ["b"]);
  assert.equal(c?.dependents.some(({ name }) => name === "a"), false);
  assert.equal(service.dependents("unknown"), null);
});

test("ambiguous symbol IDs describe each duplicate independently", () => {
  const greetMatches = service.findSymbol("greet").matches;
  const descriptions = greetMatches.map(({ id }) => service.describeSymbol(id));

  assert.equal(new Set(greetMatches.map(({ id }) => id)).size, 3);
  assert.ok(descriptions.every((description) => description?.symbol.name === "greet"));
  assert.deepEqual(
    descriptions.map((description) => [
      description?.symbol.file,
      description?.symbol.kind,
    ]),
    [
      ["src/main.ts", "function"],
      ["src/targets.ts", "method"],
      ["src/targets.ts", "function"],
    ],
  );
});

test("opening a missing index fails clearly without creating one", () => {
  const missingRepository = mkdtempSync(join(tmpdir(), "ariadne-query-missing-"));

  try {
    assert.throws(
      () => openQueryService(missingRepository),
      AriadneIndexNotFoundError,
    );
  } finally {
    rmSync(missingRepository, { recursive: true, force: true });
  }
});

function requiredMatch(name: string) {
  const match = service
    .findSymbol(name)
    .matches.find((candidate) => candidate.name === name);
  assert.ok(match);
  return match;
}
