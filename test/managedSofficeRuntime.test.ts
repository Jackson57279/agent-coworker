import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureManagedSofficeRuntimeReady } from "../src/managedSofficeRuntime";

describe("managed soffice runtime", () => {
  test("creates a PATH-first soffice shim without touching skill files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-soffice-home-"));
    const env = { PATH: "/usr/bin:/bin" };

    try {
      const result = await ensureManagedSofficeRuntimeReady({
        homedir: home,
        env,
        nodePath: "/usr/local/bin/node",
      });

      expect(result?.status).toBe("available");
      expect(result?.shimPath).toBe(path.join(home, ".cache", "cowork", "libreoffice", "bin", "soffice"));
      expect(result?.helperPath).toBe(
        path.join(home, ".cache", "cowork", "libreoffice", "libexec", "managed-soffice.mjs"),
      );
      expect(result?.runtimeEnv.COWORK_SOFFICE).toBe(result?.shimPath);
      expect(result?.runtimeEnv.COWORK_MANAGED_SOFFICE_ROOT).toBe(
        path.join(home, ".cache", "cowork", "libreoffice"),
      );
      expect(result?.runtimeEnv.PATH?.split(path.delimiter)[0]).toBe(result?.shimDir);

      const shim = await fs.readFile(result?.shimPath ?? "", "utf-8");
      const helper = await fs.readFile(result?.helperPath ?? "", "utf-8");
      expect(shim).toContain("/usr/local/bin/node");
      expect(shim).toContain("managed-soffice.mjs");
      expect(helper).toContain("download.documentfoundation.org/libreoffice/stable");
      expect(helper).toContain("COWORK_DISABLE_MANAGED_SOFFICE_DOWNLOAD");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  test("can be disabled through env", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-soffice-disabled-"));

    try {
      const result = await ensureManagedSofficeRuntimeReady({
        homedir: home,
        env: { COWORK_DISABLE_MANAGED_SOFFICE: "1" },
      });

      expect(result).toEqual({
        status: "disabled",
        runtimeEnv: {},
        reason: "COWORK_DISABLE_MANAGED_SOFFICE is enabled.",
      });
      await expect(
        fs.stat(path.join(home, ".cache", "cowork", "libreoffice", "bin", "soffice")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  test("shim fails cleanly when download is disabled and no soffice is available", async () => {
    if (process.platform === "win32") return;

    const home = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-soffice-shim-"));

    try {
      const setup = await ensureManagedSofficeRuntimeReady({
        homedir: home,
        env: { PATH: "" },
        nodePath: process.execPath,
      });
      expect(setup?.shimPath).toBeTruthy();

      const proc = Bun.spawnSync({
        cmd: [setup?.shimPath ?? "", "--version"],
        env: {
          ...process.env,
          PATH: setup?.shimDir ?? "",
          COWORK_DISABLE_MANAGED_SOFFICE_DOWNLOAD: "1",
          COWORK_IGNORE_SYSTEM_SOFFICE: "1",
          COWORK_MANAGED_SOFFICE_ROOT: setup?.rootDir ?? "",
          COWORK_MANAGED_SOFFICE_SHIM_DIR: setup?.shimDir ?? "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(127);
      await expect(fs.stat(path.join(setup?.rootDir ?? "", "runtime"))).rejects.toThrow();
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
