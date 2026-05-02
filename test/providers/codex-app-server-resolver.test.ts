import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getCodexAppServerInstallStatus,
  resolveCodexAppServerCommand,
  updateManagedCodexAppServer,
  __internal,
} from "../../src/providers/codexAppServerResolver";

const previousCommand = process.env.COWORK_CODEX_APP_SERVER_COMMAND;
const previousArgs = process.env.COWORK_CODEX_APP_SERVER_ARGS;

afterEach(() => {
  if (previousCommand === undefined) delete process.env.COWORK_CODEX_APP_SERVER_COMMAND;
  else process.env.COWORK_CODEX_APP_SERVER_COMMAND = previousCommand;
  if (previousArgs === undefined) delete process.env.COWORK_CODEX_APP_SERVER_ARGS;
  else process.env.COWORK_CODEX_APP_SERVER_ARGS = previousArgs;
});

function fakeReleaseFetch(version = "0.129.0"): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/releases/")) {
      return new Response(
        JSON.stringify({
          tag_name: `rust-v${version}`,
          assets: [
            {
              name: "codex-app-server-x86_64-pc-windows-msvc.exe",
              browser_download_url: "https://example.test/codex-app-server.exe",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("managed app-server", { status: 200 });
  }) as typeof fetch;
}

describe("codex app-server resolver", () => {
  test("uses explicit command overrides without adding implicit app-server args", async () => {
    process.env.COWORK_CODEX_APP_SERVER_COMMAND = "/tmp/custom-codex-app-server";
    process.env.COWORK_CODEX_APP_SERVER_ARGS = "";

    const command = await resolveCodexAppServerCommand({
      spawnForResult: async () => ({ ok: false, stdout: "", stderr: "" }),
    });

    expect(command).toEqual({
      command: "/tmp/custom-codex-app-server",
      args: [],
      source: "override",
    });
  });

  test("uses system codex when it is available and no managed install exists", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-system-"));
    const command = await resolveCodexAppServerCommand({
      homeDir,
      spawnForResult: async (cmd, args) => {
        expect([cmd, ...args]).toEqual(["codex", "--version"]);
        return { ok: true, stdout: "codex-cli 0.128.0\n", stderr: "" };
      },
    });

    expect(command).toEqual({
      command: "codex",
      args: ["app-server"],
      source: "system",
      version: "0.128.0",
    });
  });

  test("downloads and promotes a managed app-server when codex is missing", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-managed-"));
    const status = await updateManagedCodexAppServer(
      {},
      {
        homeDir,
        platform: "win32",
        arch: "x64",
        fetchImpl: fakeReleaseFetch("0.129.0"),
        spawnForResult: async () => ({ ok: false, stdout: "", stderr: "" }),
      },
    );

    expect(status.source).toBe("managed");
    expect(status.version).toBe("0.129.0");
    expect(status.command).toContain(path.join(".cowork", "codex-app-server", "current"));
    expect(await fs.readFile(status.command!, "utf8")).toBe("managed app-server");

    const resolved = await resolveCodexAppServerCommand({
      homeDir,
      platform: "win32",
      arch: "x64",
      spawnForResult: async () => ({ ok: true, stdout: "codex-cli 0.128.0\n", stderr: "" }),
    });
    expect(resolved.source).toBe("managed");
    expect(resolved.version).toBe("0.129.0");
  });

  test("reports update availability for older system codex", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-status-"));
    const status = await getCodexAppServerInstallStatus(
      { checkLatest: true },
      {
        homeDir,
        fetchImpl: fakeReleaseFetch("0.129.0"),
        spawnForResult: async () => ({ ok: true, stdout: "codex-cli 0.128.0\n", stderr: "" }),
      },
    );

    expect(status).toMatchObject({
      available: true,
      source: "system",
      version: "0.128.0",
      latestVersion: "0.129.0",
      updateAvailable: true,
    });
  });

  test("parses Codex CLI version strings", () => {
    expect(__internal.parseCodexVersion("codex-cli 0.128.0")).toBe("0.128.0");
    expect(__internal.parseCodexVersion("0.129.1")).toBe("0.129.1");
  });
});
