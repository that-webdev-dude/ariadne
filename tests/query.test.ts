import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { extractProject } from "../src/extractor/project.js";
import {
  FIND_SYMBOL_QUERY_BYTE_LIMIT,
  FIND_SYMBOL_RESPONSE_BYTE_LIMIT,
  type AriadneQueryService,
  openQueryService,
} from "../src/query/service.js";
import { createSymbolId, parseSymbolId } from "../src/symbolId.js";
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
      files: 6,
      symbols: 39,
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

test("symbol IDs round trip compact repository-relative declaration identity", () => {
  const identity = {
    filePath: "src/scene.ts",
    kind: "function" as const,
    startLine: 12,
    startColumn: 3,
  };
  const id = createSymbolId(identity);

  assert.match(id, /^sym_[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseSymbolId(id), identity);
  assert.deepEqual(
    JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8")),
    ["src/scene.ts", "function", 12, 3],
  );
  assert.throws(
    () => createSymbolId({ ...identity, filePath: resolve("src/scene.ts") }),
    /repository-relative/,
  );
});

test("malformed and obsolete symbol IDs do not parse", () => {
  const encoded = (value: unknown) =>
    `sym_${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;

  for (const id of [
    "not_sym",
    "sym_not-json",
    encoded(["src/scene.ts", "qualified", "function", 1, 1]),
    encoded(["src/scene.ts", "unknown", 1, 1]),
    encoded(["src/scene.ts", "function", 0, 1]),
    encoded([resolve("src/scene.ts"), "function", 1, 1]),
  ]) {
    assert.equal(parseSymbolId(id), null);
  }
});

test("repository symbol lookup fails closed when compact identity is ambiguous", () => {
  const ambiguousRepositoryPath = mkdtempSync(
    join(tmpdir(), "ariadne-query-ambiguous-"),
  );
  initializeIndex(ambiguousRepositoryPath, {
    files: [
      {
        path: "src/ambiguous.ts",
        symbols: [
          {
            name: "first",
            qualifiedName: "project.first",
            kind: "function",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 10,
            signature: "(): void",
          },
          {
            name: "second",
            qualifiedName: "project.second",
            kind: "function",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 11,
            signature: "(): void",
          },
        ],
      },
    ],
    imports: [],
    calls: [],
  });
  const repository = AriadneRepository.open(ambiguousRepositoryPath);
  const id = createSymbolId({
    filePath: "src/ambiguous.ts",
    kind: "function",
    startLine: 1,
    startColumn: 1,
  });

  try {
    assert.equal(repository.getSymbolById(id), null);
    assert.deepEqual(repository.getOutgoingCalls(id, 10), {
      symbols: [],
      truncated: false,
    });
  } finally {
    repository.close();
    rmSync(ambiguousRepositoryPath, { recursive: true, force: true });
  }
});

test("repoOverview returns bounded deterministic orientation", () => {
  const first = service.repoOverview();
  const second = service.repoOverview();

  assert.equal(first.repositoryRoot, resolve(repositoryPath));
  assert.equal(typeof first.indexedAt, "string");
  assert.equal(first.indexerVersion, INDEXER_VERSION);
  assert.deepEqual(first.counts, {
    files: 6,
    symbols: 39,
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

  assert.equal(greet.matches.slice(0, 3).length, 3);
  assert.ok(
    greet.matches.slice(0, 3).every(({ match }) => match === "exact_name"),
  );
  assert.equal(new Set(greet.matches.map(({ id }) => id)).size, greet.matches.length);

  const mainGreet = greet.matches.find(({ file }) => file === "src/main.ts");
  assert.ok(mainGreet);
  const mainGreetDescription = service.describeSymbol(mainGreet.id);
  assert.ok(mainGreetDescription);
  assert.equal(
    service.findSymbol(mainGreetDescription.symbol.qualifiedName.toUpperCase())
      .matches[0]?.match,
    "exact_qualified",
  );
  const qualifiedSuffix = service.findSymbol("GREETER.GREET").matches[0];
  assert.deepEqual(
    qualifiedSuffix && [qualifiedSuffix.kind, qualifiedSuffix.match],
    ["method", "suffix"],
  );
  const prefix = service.findSymbol("CALL").matches[0];
  assert.deepEqual(
    prefix && [prefix.name, prefix.match],
    ["caller", "prefix"],
  );
  assert.deepEqual(
    service.findSymbol("THER").matches.map(({ name, match }) => [name, match]),
    [["otherCaller", "substring"]],
  );
  assert.equal(service.findSymbol("greet", { limit: 1 }).matches.length, 1);
  assert.deepEqual(service.findSymbol("doesNotExist"), {
    query: "doesNotExist",
    matches: [],
  });
});

test("findSymbol ranks all evidence before applying a compact weak-result ceiling", () => {
  const exact = service.findSymbol("SCENEMANAGER");
  assert.equal(exact.matches[0]?.name, "SceneManager");
  assert.equal(exact.matches[0]?.match, "exact_name");

  const lowercase = service.findSymbol("scene", { limit: 50 });
  assert.ok(lowercase.matches.length <= 12);
  assert.ok(lowercase.matches.length < 50);
  assert.ok(
    lowercase.matches.findIndex(({ name }) => name === "createSceneManager") < 10,
  );
  assert.ok(
    lowercase.matches.findIndex(({ name }) => name === "createSceneManager") <
      lowercase.matches.findIndex(({ name }) => name === "SceneManagerService"),
  );
  assert.equal(lowercase.matches.some(({ name }) => name === "loadConfig"), false);
  assert.ok(
    service
      .findSymbol("scene", { limit: 12 })
      .matches.findIndex(({ name }) => name === "createSceneManager") < 10,
  );

  const phrase = service.findSymbol("scene manager", { limit: 50 });
  assert.ok(phrase.matches.length <= 12);
  assert.deepEqual(
    phrase.matches.slice(0, 2).map(({ name }) => name),
    ["createSceneManager", "createSceneManagerService"],
  );
  assert.ok(
    phrase.matches.findIndex(({ name }) => name === "SceneManagerService") < 5,
  );

  const camelCase = service.findSymbol("changeScene");
  assert.ok(camelCase.matches.some(({ name }) => name === "createSceneManager"));
  assert.ok(camelCase.matches.every(({ match }) => match === "token"));

  const coverage = service.findSymbol("scene change update render", {
    limit: 20,
  });
  const beginUpdate = coverage.matches.findIndex(
    ({ name, kind }) => name === "beginUpdate" && kind === "function",
  );
  const prepareRender = coverage.matches.findIndex(
    ({ name, kind }) => name === "prepareRender" && kind === "function",
  );
  assert.ok(coverage.matches.length <= 12);
  assert.ok(beginUpdate >= 0 && beginUpdate < 10);
  assert.ok(prepareRender >= 0 && prepareRender < 10);
  assert.ok(coverage.matches.some(({ name }) => name === "createSceneManager"));
  assert.equal(coverage.matches.some(({ name }) => name === "loadConfig"), false);

  const fullIdentifier = service.findSymbol("prepareRender", { limit: 50 });
  assert.ok(fullIdentifier.matches.length <= 12);
  assert.ok(
    fullIdentifier.matches
      .slice(0, 2)
      .every(({ name, match }) => name === "prepareRender" && match === "exact_name"),
  );
  assert.ok(
    fullIdentifier.matches.findIndex(
      ({ name, kind }) => name === "prepareRender" && kind === "function",
    ) < 2,
  );
  assert.deepEqual(
    service.findSymbol("scene change update render", { limit: 20 }),
    service.findSymbol("scene change update render", { limit: 20 }),
  );
});

test("findSymbol treats the public limit as a ceiling and preserves exact ambiguity", () => {
  const weakFallback = service.findSymbol("scene manager", { limit: 50 });
  assert.ok(weakFallback.matches.length <= 12);
  assert.ok(
    Buffer.byteLength(JSON.stringify(weakFallback), "utf8") <=
      FIND_SYMBOL_RESPONSE_BYTE_LIMIT,
  );

  const exactAmbiguity = service
    .findSymbol("greet", { limit: 50 })
    .matches.filter(({ name, match }) => name === "greet" && match === "exact_name");
  assert.equal(exactAmbiguity.length, 3);
  assert.equal(service.findSymbol("scene manager", { limit: 1 }).matches.length, 1);
});

test("findSymbol enforces its UTF-8 query bound for ASCII and multibyte input", () => {
  assert.doesNotThrow(() =>
    service.findSymbol("a".repeat(FIND_SYMBOL_QUERY_BYTE_LIMIT)),
  );
  assert.throws(
    () => service.findSymbol("a".repeat(FIND_SYMBOL_QUERY_BYTE_LIMIT + 1)),
    /512 UTF-8 bytes/,
  );
  assert.doesNotThrow(() =>
    service.findSymbol("é".repeat(FIND_SYMBOL_QUERY_BYTE_LIMIT / 2)),
  );
  assert.throws(
    () => service.findSymbol("é".repeat(FIND_SYMBOL_QUERY_BYTE_LIMIT / 2 + 1)),
    /512 UTF-8 bytes/,
  );
});

test("findSymbol preserves ranking and stops before the first result over 8 KiB", () => {
  const budgetRepositoryPath = mkdtempSync(
    join(tmpdir(), "ariadne-query-budget-"),
  );
  const paths = Array.from(
    { length: 100 },
    (_, index) =>
      `src/${String(index).padStart(3, "0")}-${"long-path-".repeat(12)}.ts`,
  );

  initializeIndex(budgetRepositoryPath, {
    files: paths.map((path, index) => ({
      path,
      symbols: [
        {
          name: "target",
          qualifiedName: `project.target${index}`,
          kind: "function" as const,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 10,
          signature: "(): void",
        },
      ],
    })),
    imports: [],
    calls: [],
  });
  const budgetService = openQueryService(budgetRepositoryPath);

  try {
    const result = budgetService.findSymbol("target", { limit: 100 });
    const expected = paths.map((file) => ({
      id: createSymbolId({
        filePath: file,
        kind: "function",
        startLine: 1,
        startColumn: 1,
      }),
      name: "target",
      kind: "function" as const,
      file,
      line: 1,
      match: "exact_name" as const,
    }));

    assert.ok(result.matches.length < expected.length);
    assert.deepEqual(result.matches, expected.slice(0, result.matches.length));
    assert.ok(
      Buffer.byteLength(JSON.stringify(result), "utf8") <=
        FIND_SYMBOL_RESPONSE_BYTE_LIMIT,
    );
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          query: result.query,
          matches: [...result.matches, expected[result.matches.length]],
        }),
        "utf8",
      ) > FIND_SYMBOL_RESPONSE_BYTE_LIMIT,
    );
    assert.deepEqual(
      budgetService.findSymbol("target", { limit: 2 }).matches,
      expected.slice(0, 2),
    );
  } finally {
    budgetService.close();
    rmSync(budgetRepositoryPath, { recursive: true, force: true });
  }
});

test("findSymbol prefers non-test token ties without filtering exact tests", () => {
  const tokenMatches = service
    .findSymbol("scene helper")
    .matches.filter(({ name }) => name === "sceneHelper");
  assert.deepEqual(
    tokenMatches.map(({ file, match }) => [file, match]),
    [
      ["src/scene.ts", "token"],
      ["src/scene.test.ts", "token"],
    ],
  );

  const exactMatches = service.findSymbol("sceneHelper").matches;
  assert.equal(exactMatches.filter(({ name }) => name === "sceneHelper").length, 2);
  assert.ok(
    exactMatches
      .filter(({ name }) => name === "sceneHelper")
      .every(({ match }) => match === "exact_name"),
  );
});

test("describeSymbol returns exact one-hop details without database IDs", () => {
  const a = requiredMatch("a");
  const description = service.describeSymbol(a.id);

  assert.ok(description);
  assert.equal(description.symbol.id, a.id);
  assert.equal(typeof description.symbol.qualifiedName, "string");
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

test("compact projections omit qualified names and all returned IDs resolve", () => {
  const found = service.findSymbol("a");
  const a = requiredMatch("a");
  const description = service.describeSymbol(a.id);
  const dependencies = service.dependencies(a.id);
  const dependents = service.dependents(a.id);
  assert.ok(description);
  assert.ok(dependencies);
  assert.ok(dependents);

  const summaries = [
    ...service.repoOverview().entryCandidates,
    ...found.matches,
    ...description.calls,
    ...description.calledBy,
    dependencies.symbol,
    ...dependencies.dependencies,
    dependents.symbol,
    ...dependents.dependents,
  ];

  assert.ok(summaries.length > 0);
  assert.ok(summaries.every((summary) => !("qualifiedName" in summary)));
  assert.ok(summaries.every(({ id }) => service.describeSymbol(id) !== null));
  assert.equal(typeof description.symbol.qualifiedName, "string");
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
  const greetMatches = service
    .findSymbol("greet")
    .matches.filter(({ name }) => name === "greet");
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
