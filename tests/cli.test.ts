import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const cliPath = resolve(import.meta.dirname, "../src/cli.js");

function runCli(repositoryPath: string) {
  return spawnSync(process.execPath, [cliPath, "index", repositoryPath], {
    encoding: "utf8",
  });
}

test("CLI creates and cleanly replaces an empty P0 index", () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "ariadne-cli-"));
  const databasePath = join(repositoryPath, ".ari", "index.sqlite");

  try {
    const firstRun = runCli(repositoryPath);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.match(firstRun.stdout, /Ariadne index initialized/);
    assert.equal(existsSync(databasePath), true);

    const database = new DatabaseSync(databasePath);
    database.exec("INSERT INTO files (path) VALUES ('old.ts')");
    database.close();

    const secondRun = runCli(repositoryPath);
    assert.equal(secondRun.status, 0, secondRun.stderr);

    const rebuiltDatabase = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(rebuiltDatabase.prepare("SELECT COUNT(*) AS count FROM files").get()?.count, 0);
    assert.equal(rebuiltDatabase.prepare("SELECT COUNT(*) AS count FROM symbols").get()?.count, 0);
    assert.equal(
      rebuiltDatabase.prepare("SELECT value FROM metadata WHERE key = 'repository_root'").get()?.value,
      resolve(repositoryPath),
    );
    rebuiltDatabase.close();
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});
