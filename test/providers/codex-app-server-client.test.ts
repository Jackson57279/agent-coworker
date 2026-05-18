import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __internal, withCodexAppServerClient } from "../../src/providers/codexAppServerClient";

const originalHome = process.env.HOME;
const originalCommand = process.env.COWORK_CODEX_APP_SERVER_COMMAND;
const originalArgs = process.env.COWORK_CODEX_APP_SERVER_ARGS;
const originalCodexHome = process.env.CODEX_HOME;

async function makeTmpHome(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-client-test-"));
}

describe("codex app-server client", () => {
  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalCommand === undefined) {
      delete process.env.COWORK_CODEX_APP_SERVER_COMMAND;
    } else {
      process.env.COWORK_CODEX_APP_SERVER_COMMAND = originalCommand;
    }
    if (originalArgs === undefined) {
      delete process.env.COWORK_CODEX_APP_SERVER_ARGS;
    } else {
      process.env.COWORK_CODEX_APP_SERVER_ARGS = originalArgs;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
  });

  test("starts app-server with Cowork-owned CODEX_HOME", async () => {
    const home = await makeTmpHome();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-client-script-"));
    const envFile = path.join(dir, "env.json");
    const script = path.join(dir, "mock-codex-app-server.js");
    await fs.writeFile(
      script,
      `const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ CODEX_HOME: process.env.CODEX_HOME }));
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  }
});
`,
      "utf8",
    );

    process.env.HOME = home;
    process.env.CODEX_HOME = path.join(home, ".codex-should-not-be-used");
    process.env.COWORK_CODEX_APP_SERVER_COMMAND = process.execPath;
    process.env.COWORK_CODEX_APP_SERVER_ARGS = script;

    await withCodexAppServerClient(async () => undefined);

    const expectedCodexHome = path.join(home, ".cowork", "auth", "codex-cli");
    expect(__internal.resolveCodexHome()).toBe(expectedCodexHome);
    expect(JSON.parse(await fs.readFile(envFile, "utf8"))).toEqual({
      CODEX_HOME: expectedCodexHome,
    });
    expect((await fs.stat(expectedCodexHome)).isDirectory()).toBe(true);
  });
});
