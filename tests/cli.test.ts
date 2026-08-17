import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { INDEXER_VERSION } from "../src/store/database.js";
import { SCHEMA_VERSION } from "../src/store/schema.js";

const cliPath = resolve(import.meta.dirname, "../src/cli.js");
const fixturePath = resolve(
  import.meta.dirname,
  "../../tests/fixtures/basic-project",
);

function runCli(repositoryPath: string) {
  return spawnSync(process.execPath, [cliPath, "index", repositoryPath], {
    encoding: "utf8",
  });
}

test("CLI indexes a TypeScript project and cleanly replaces its P0 index", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "ariadne-cli-"));
  const databasePath = join(repositoryPath, ".ari", "index.sqlite");

  try {
    cpSync(fixturePath, repositoryPath, { recursive: true });
    const firstRun = runCli(repositoryPath);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.match(firstRun.stdout, /Ariadne index initialized/);
    assert.match(firstRun.stdout, /Files indexed: 2/);
    assert.match(firstRun.stdout, /Symbols indexed: 11/);
    assert.equal(existsSync(databasePath), true);

    const database = new DatabaseSync(databasePath);
    database.exec("INSERT INTO files (path) VALUES ('old.ts')");
    database.close();

    const secondRun = runCli(repositoryPath);
    assert.equal(secondRun.status, 0, secondRun.stderr);

    const rebuiltDatabase = new DatabaseSync(databasePath, { readOnly: true });

    assert.equal(
      rebuiltDatabase.prepare("SELECT COUNT(*) AS count FROM files").get()
        ?.count,
      2,
    );

    assert.equal(
      rebuiltDatabase.prepare("SELECT COUNT(*) AS count FROM symbols").get()
        ?.count,
      11,
    );

    assert.equal(
      rebuiltDatabase
        .prepare("SELECT COUNT(*) AS count FROM files WHERE path = 'old.ts'")
        .get()?.count,
      0,
    );

    const persistedFunction = rebuiltDatabase
      .prepare(`
        SELECT files.path, symbols.*
        FROM symbols
        JOIN files ON files.id = symbols.file_id
        WHERE symbols.name = 'localHelper'
      `)
      .get();

    assert.equal(persistedFunction?.path, "src/main.ts");
    assert.equal(typeof persistedFunction?.file_id, "number");
    assert.equal(persistedFunction?.kind, "function");
    assert.equal(persistedFunction?.start_line, 5);
    assert.equal(persistedFunction?.start_column, 1);
    assert.equal(persistedFunction?.signature, "(value: string): string");
    assert.equal(typeof persistedFunction?.qualified_name, "string");
    assert.equal(typeof persistedFunction?.end_line, "number");
    assert.equal(typeof persistedFunction?.end_column, "number");

    assert.equal(
      rebuiltDatabase
        .prepare("SELECT value FROM metadata WHERE key = 'repository_root'")
        .get()?.value,
      resolve(repositoryPath),
    );

    assert.equal(
      rebuiltDatabase
        .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
        .get()?.value,
      SCHEMA_VERSION,
    );

    assert.equal(
      rebuiltDatabase
        .prepare("SELECT value FROM metadata WHERE key = 'indexer_version'")
        .get()?.value,
      INDEXER_VERSION,
    );

    const indexedAt = rebuiltDatabase
      .prepare("SELECT value FROM metadata WHERE key = 'indexed_at'")
      .get()?.value;

    assert.equal(typeof indexedAt, "string");
    assert.equal(Number.isNaN(Date.parse(indexedAt as string)), false);

    rebuiltDatabase.close();
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});

test("CLI fails for a nonexistent repository path", () => {
  const parentDirectory = mkdtempSync(join(tmpdir(), "ariadne-cli-missing-"));
  const repositoryPath = join(parentDirectory, "does-not-exist");

  try {
    const result = runCli(repositoryPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT|no such file or directory/i);
    assert.equal(
      existsSync(join(repositoryPath, ".ari", "index.sqlite")),
      false,
    );
  } finally {
    rmSync(parentDirectory, { recursive: true, force: true });
  }
});
