import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { extractProject } from "../src/extractor/project.js";
import { loadProject } from "../src/project/loader.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../tests/fixtures/relationships-project",
);
const cliPath = resolve(import.meta.dirname, "../src/cli.js");

test("extractor resolves local imports and direct calls without guessing", () => {
  const extracted = extractProject(loadProject(fixturePath));

  assert.deepEqual(
    extracted.imports.map(({ sourcePath, targetPath, specifier }) => [
      sourcePath,
      targetPath,
      specifier,
    ]),
    [
      ["src/barrel.ts", "src/math.ts", "./math.js"],
      ["src/main.ts", "src/math.ts", "./math.js"],
      ["src/main.ts", "src/side-effect.ts", "./side-effect.js"],
    ],
  );

  const edges = extracted.calls
    .map(({ sourceSymbol, targetSymbol }) =>
      [
        sourceSymbol.filePath,
        sourceSymbol.name,
        sourceSymbol.kind,
        targetSymbol.filePath,
        targetSymbol.name,
        targetSymbol.kind,
      ].join("|"),
    )
    .sort();

  assert.deepEqual(edges, [
    "src/main.ts|duplicate|function|src/math.ts|helper|function",
    "src/main.ts|execute|callable_variable|src/math.ts|helper|function",
    "src/main.ts|localCaller|function|src/main.ts|localTarget|function",
    "src/main.ts|recursive|function|src/main.ts|recursive|function",
    "src/main.ts|runAlias|function|src/math.ts|calculate|function",
    "src/main.ts|runImported|function|src/math.ts|calculate|function",
    "src/main.ts|runMethod|function|src/math.ts|greet|method",
    "src/main.ts|runNamespace|function|src/math.ts|calculate|function",
    "src/math.ts|calculate|function|src/math.ts|helper|function",
    "src/math.ts|greet|method|src/math.ts|helper|function",
  ]);

  assert.equal(
    extracted.calls.some(
      ({ sourceSymbol }) =>
        sourceSymbol.name === "runCallback" || sourceSymbol.name === "runAny",
    ),
    false,
  );
  assert.equal(
    extracted.calls.filter(
      ({ sourceSymbol, targetSymbol }) =>
        sourceSymbol.name === "duplicate" && targetSymbol.name === "helper",
    ).length,
    1,
  );
});

test("CLI persists and cleanly rebuilds imports and call relationships", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "ariadne-relations-"));
  const databasePath = join(repositoryPath, ".ari", "index.sqlite");
  let rebuilt: DatabaseSync | undefined;

  try {
    cpSync(fixturePath, repositoryPath, { recursive: true });
    const firstRun = runCli(repositoryPath);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.match(firstRun.stdout, /Files indexed: 4/);
    assert.match(firstRun.stdout, /Symbols indexed: 15/);
    assert.match(firstRun.stdout, /Imports indexed: 3/);
    assert.match(firstRun.stdout, /Calls indexed: 10/);

    const database = new DatabaseSync(databasePath);
    const mainFileId = database
      .prepare("SELECT id FROM files WHERE path = 'src/main.ts'")
      .get()?.id;
    const barrelFileId = database
      .prepare("SELECT id FROM files WHERE path = 'src/barrel.ts'")
      .get()?.id;
    const classId = database
      .prepare("SELECT id FROM symbols WHERE name = 'Greeter' AND kind = 'class'")
      .get()?.id;
    const helperId = database
      .prepare("SELECT id FROM symbols WHERE name = 'helper' AND kind = 'function'")
      .get()?.id;
    database
      .prepare(
        "INSERT INTO imports (source_file_id, target_file_id, specifier) VALUES (?, ?, 'stale')",
      )
      .run(mainFileId as number, barrelFileId as number);
    database
      .prepare(
        "INSERT INTO relationships (source_symbol_id, target_symbol_id) VALUES (?, ?)",
      )
      .run(classId as number, helperId as number);
    database.close();

    const secondRun = runCli(repositoryPath);
    assert.equal(secondRun.status, 0, secondRun.stderr);

    rebuilt = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(count(rebuilt, "files"), 4);
    assert.equal(count(rebuilt, "symbols"), 15);
    assert.equal(count(rebuilt, "imports"), 3);
    assert.equal(count(rebuilt, "relationships"), 10);
    assert.deepEqual(rebuilt.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      rebuilt
        .prepare("SELECT COUNT(*) AS count FROM imports WHERE specifier = 'stale'")
        .get()?.count,
      0,
    );

    assert.deepEqual(
      rebuilt
        .prepare(`
          SELECT source.path AS source_path, target.path AS target_path, imports.specifier
          FROM imports
          JOIN files AS source ON source.id = imports.source_file_id
          JOIN files AS target ON target.id = imports.target_file_id
          ORDER BY source.path, target.path
        `)
        .all()
        .map((row) => [row.source_path, row.target_path, row.specifier]),
      [
        ["src/barrel.ts", "src/math.ts", "./math.js"],
        ["src/main.ts", "src/math.ts", "./math.js"],
        ["src/main.ts", "src/side-effect.ts", "./side-effect.js"],
      ],
    );

    const persistedEdges = rebuilt
      .prepare(`
        SELECT
          source_file.path AS source_path,
          source.name AS source_name,
          source.kind AS source_kind,
          target_file.path AS target_path,
          target.name AS target_name,
          target.kind AS target_kind
        FROM relationships
        JOIN symbols AS source ON source.id = relationships.source_symbol_id
        JOIN files AS source_file ON source_file.id = source.file_id
        JOIN symbols AS target ON target.id = relationships.target_symbol_id
        JOIN files AS target_file ON target_file.id = target.file_id
      `)
      .all();

    assert.ok(
      persistedEdges.some(
        (edge) =>
          edge.source_path === "src/main.ts" &&
          edge.source_name === "runAlias" &&
          edge.target_path === "src/math.ts" &&
          edge.target_name === "calculate",
      ),
    );
    assert.ok(
      persistedEdges.some(
        (edge) =>
          edge.source_name === "runMethod" &&
          edge.target_name === "greet" &&
          edge.target_kind === "method",
      ),
    );
    assert.equal(
      persistedEdges.some(
        (edge) =>
          edge.source_name === "runCallback" || edge.source_name === "runAny",
      ),
      false,
    );
  } finally {
    rebuilt?.close();
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});

function runCli(repositoryPath: string) {
  return spawnSync(process.execPath, [cliPath, "index", repositoryPath], {
    encoding: "utf8",
  });
}

function count(database: DatabaseSync, table: string): number {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
    ?.count as number;
}
