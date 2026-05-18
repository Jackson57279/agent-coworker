import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loginCodexAppServerChatGpt,
  readCodexAppServerAccount,
  readCodexAppServerRateLimits,
} from "../../src/providers/codexAppServerAuth";
import { __internal as clientInternal } from "../../src/providers/codexAppServerClient";

describe("codex app-server auth", () => {
  afterEach(() => {
    clientInternal.setClientFactoryForTests(undefined);
  });

  test("returns not logged in without starting process if auth.json is missing", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-auth-missing-"));
    let clientStarted = false;

    clientInternal.setClientFactoryForTests(async () => {
      clientStarted = true;
      throw new Error("Should not start client");
    });

    const result = await readCodexAppServerAccount({ codexHome });
    expect(result).toEqual({ account: null, requiresOpenaiAuth: true });
    expect(clientStarted).toBe(false);
  });

  test("reads account information when auth.json exists", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-auth-existing-"));
    await fs.writeFile(path.join(codexHome, "auth.json"), "{}", "utf8");

    let requestedMethod = "";

    clientInternal.setClientFactoryForTests(async () => {
      return {
        command: { command: "node", args: [], source: "managed" },
        isClosed: () => false,
        request: async (method) => {
          requestedMethod = method;
          if (method === "initialize") return {};
          if (method === "account/read") {
            return {
              account: { type: "chatgpt", email: "test@example.com", planType: "Pro" },
              requiresOpenaiAuth: false,
            };
          }
          return {};
        },
        notify: () => {},
        interruptTurn: async () => {},
        onNotification: () => () => {},
        onServerRequest: () => () => {},
        onJsonRpcMessage: () => () => {},
        close: async () => {},
      };
    });

    const result = await readCodexAppServerAccount({ codexHome });
    expect(requestedMethod).toBe("account/read");
    expect(result).toEqual({
      account: { type: "chatgpt", email: "test@example.com", planType: "Pro" },
      requiresOpenaiAuth: false,
    });
  });

  test("reads rate limits", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-auth-limits-"));
    await fs.writeFile(path.join(codexHome, "auth.json"), "{}", "utf8");

    clientInternal.setClientFactoryForTests(async () => {
      return {
        command: { command: "node", args: [], source: "managed" },
        isClosed: () => false,
        request: async (method) => {
          if (method === "account/rateLimits/read") {
            return {
              rateLimits: {
                primary: { usedPercent: 42, windowDurationMins: 15 },
              },
            };
          }
          return {};
        },
        notify: () => {},
        interruptTurn: async () => {},
        onNotification: () => () => {},
        onServerRequest: () => () => {},
        onJsonRpcMessage: () => () => {},
        close: async () => {},
      };
    });

    const result = await readCodexAppServerRateLimits({ codexHome });
    expect(result).toEqual({
      primary: { usedPercent: 42, windowDurationMins: 15 },
    });
  });
});
