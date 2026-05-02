import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntime } from "../src/runtime";
import type { AgentConfig } from "../src/types";

const previousCommand = process.env.COWORK_CODEX_APP_SERVER_COMMAND;
const previousArgs = process.env.COWORK_CODEX_APP_SERVER_ARGS;

function makeConfig(dir: string): AgentConfig {
  return {
    provider: "codex-cli",
    runtime: "codex-app-server",
    model: "gpt-5.4",
    preferredChildModel: "gpt-5.4",
    workingDirectory: dir,
    outputDirectory: path.join(dir, "output"),
    uploadsDirectory: path.join(dir, "uploads"),
    userName: "",
    knowledgeCutoff: "unknown",
    projectCoworkDir: path.join(dir, ".cowork"),
    userCoworkDir: path.join(dir, ".cowork-user"),
    builtInDir: dir,
    builtInConfigDir: path.join(dir, "config"),
    skillsDirs: [],
    memoryDirs: [],
    configDirs: [],
  };
}

async function writeMockAppServer(dir: string): Promise<string> {
  const script = path.join(dir, "mock-codex-app-server.js");
  await fs.writeFile(
    script,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { userAgent: "mock" } });
    return;
  }
  if (msg.method === "initialized") return;
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: "thread_1", modelProvider: "openai", turns: [] }, model: "gpt-5.4", modelProvider: "openai", cwd: process.cwd(), approvalPolicy: "never", sandbox: { type: "dangerFullAccess" }, reasoningEffort: "high" } });
    return;
  }
  if (msg.method === "turn/start") {
    send({ id: msg.id, result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } } });
    send({ method: "item/started", params: { threadId: "thread_1", turnId: "turn_1", item: { type: "agentMessage", id: "item_1", text: "", phase: null, memoryCitation: null } } });
    send({ method: "item/agentMessage/delta", params: { threadId: "thread_1", turnId: "turn_1", itemId: "item_1", delta: "hello from app-server" } });
    send({ method: "item/completed", params: { threadId: "thread_1", turnId: "turn_1", item: { type: "agentMessage", id: "item_1", text: "hello from app-server", phase: null, memoryCitation: null } } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "thread_1", turnId: "turn_1", tokenUsage: { total: { totalTokens: 7, inputTokens: 3, cachedInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0 }, last: { totalTokens: 7, inputTokens: 3, cachedInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0 }, modelContextWindow: 272000 } } });
    send({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed", items: [{ type: "agentMessage", id: "item_1", text: "hello from app-server", phase: null, memoryCitation: null }], error: null } } });
  }
});
`,
    "utf-8",
  );
  return script;
}

afterEach(() => {
  if (previousCommand === undefined) delete process.env.COWORK_CODEX_APP_SERVER_COMMAND;
  else process.env.COWORK_CODEX_APP_SERVER_COMMAND = previousCommand;
  if (previousArgs === undefined) delete process.env.COWORK_CODEX_APP_SERVER_ARGS;
  else process.env.COWORK_CODEX_APP_SERVER_ARGS = previousArgs;
});

describe("codex app-server runtime", () => {
  test("drives a turn through codex app-server JSONL", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-codex-app-server-runtime-"));
    const script = await writeMockAppServer(dir);
    process.env.COWORK_CODEX_APP_SERVER_COMMAND = process.execPath;
    process.env.COWORK_CODEX_APP_SERVER_ARGS = script;

    const streamParts: unknown[] = [];
    const rawEvents: unknown[] = [];
    const runtime = createRuntime(makeConfig(dir));
    const result = await runtime.runTurn({
      config: makeConfig(dir),
      system: "You are Codex.",
      messages: [{ role: "user", content: "Say hi" }],
      tools: {},
      maxSteps: 1,
      onModelStreamPart: (part) => {
        streamParts.push(part);
      },
      onModelRawEvent: (event) => {
        rawEvents.push(event);
      },
    });

    expect(result.text).toBe("hello from app-server");
    expect(result.usage).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
      cachedPromptTokens: 0,
    });
    expect(result.providerState).toMatchObject({
      provider: "codex-cli",
      model: "gpt-5.4",
      threadId: "thread_1",
    });
    expect(streamParts.some((part) => (part as { type?: string }).type === "text-delta")).toBe(
      true,
    );
    expect(rawEvents).toContainEqual(
      expect.objectContaining({
        format: "codex-app-server-v2",
      }),
    );
  });
});
