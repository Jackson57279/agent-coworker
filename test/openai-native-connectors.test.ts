import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __internal as codexAppServerAuthInternal } from "../src/providers/codexAppServerAuth";
import {
  listOpenAiNativeConnectors,
  setOpenAiNativeConnectorEnabled,
} from "../src/server/connectors/openaiNativeConnectors";
import type { AgentConfig } from "../src/types";

function makeConfig(workspaceRoot: string, home: string): AgentConfig {
  return {
    provider: "codex-cli",
    model: "gpt-5.4",
    preferredChildModel: "gpt-5.4",
    workingDirectory: workspaceRoot,
    outputDirectory: path.join(workspaceRoot, "output"),
    uploadsDirectory: path.join(workspaceRoot, "uploads"),
    userName: "tester",
    knowledgeCutoff: "unknown",
    projectCoworkDir: path.join(workspaceRoot, ".cowork"),
    userCoworkDir: path.join(home, ".cowork"),
    builtInDir: workspaceRoot,
    builtInConfigDir: path.join(workspaceRoot, "config"),
    skillsDirs: [path.join(home, ".cowork", "skills")],
    memoryDirs: [],
    configDirs: [],
    experimentalFeatures: { openAiNativeConnectors: true },
  };
}

describe("OpenAI native connectors", () => {
  test("lists Codex app-server apps when Codex is signed in", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "connectors-workspace-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "connectors-home-"));
    const config = makeConfig(workspaceRoot, home);
    codexAppServerAuthInternal.setAuthOverridesForTests({
      readAccount: async () => ({
        account: { type: "chatgpt", email: "tester@example.com" },
        requiresOpenaiAuth: true,
      }),
      listApps: async () => [
        {
          id: "connector_gmail",
          name: "Gmail",
          description: "Search mail",
          isAccessible: true,
          isEnabled: true,
        },
      ],
    });
    try {
      const snapshot = await listOpenAiNativeConnectors({
        config,
        forceRefetch: true,
      });

      expect(snapshot.authenticated).toBe(true);
      expect(snapshot.enabledConnectorIds).toEqual(["connector_gmail"]);
      expect(snapshot.connectors).toEqual([
        expect.objectContaining({
          id: "connector_gmail",
          name: "Gmail",
          isAccessible: true,
          isEnabled: true,
        }),
      ]);
    } finally {
      codexAppServerAuthInternal.resetAuthOverridesForTests();
    }
  });

  test("persists connector enabled state through Codex app-server config", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "connectors-config-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "connectors-config-home-"));
    const config = makeConfig(workspaceRoot, home);
    const writes: Array<{ appId: string; enabled: boolean }> = [];
    codexAppServerAuthInternal.setAuthOverridesForTests({
      setAppEnabled: async (opts) => {
        writes.push({ appId: opts.appId, enabled: opts.enabled });
      },
    });

    try {
      await setOpenAiNativeConnectorEnabled(config, "connector_dropbox", true);

      expect(writes).toEqual([{ appId: "connector_dropbox", enabled: true }]);
      await expect(
        fs.readFile(path.join(config.projectCoworkDir, "openai-native-connectors.json"), "utf-8"),
      ).rejects.toThrow();
    } finally {
      codexAppServerAuthInternal.resetAuthOverridesForTests();
    }
  });
});
