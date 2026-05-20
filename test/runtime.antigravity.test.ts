import { describe, expect, mock, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeRunTurnParams } from "../src/runtime/types";
import type { AgentConfig, ModelMessage } from "../src/types";

// Setup Mock for unofficial-antigravity-sdk
mock.module("unofficial-antigravity-sdk", () => {
  class MockText {
    constructor(
      public stepIndex: number,
      public text: string,
    ) {}
  }
  class MockThought {
    constructor(
      public stepIndex: number,
      public text: string,
    ) {}
  }
  class MockLocalAgentConfig {
    constructor(public options?: any) {
      if (options) Object.assign(this, options);
    }
  }
  class MockCapabilitiesConfig {
    constructor(public options?: any) {
      if (options) Object.assign(this, options);
    }
  }

  let chatMockImpl: (prompt: string) => Promise<any>;
  let lastCreatedInstance: any = null;

  class MockAgent {
    static __setChatMockImpl(impl: typeof chatMockImpl) {
      chatMockImpl = impl;
    }

    static getLastInstance() {
      return lastCreatedInstance;
    }

    static open = mock(async (config: any) => {
      const agent = new MockAgent(config);
      await agent.start();
      return agent;
    });

    constructor(public config: any) {
      lastCreatedInstance = this;
    }
    isConnected = false;

    async start() {
      this.isConnected = true;
    }

    async stop() {
      this.isConnected = false;
    }

    async chat(prompt: string) {
      if (chatMockImpl) {
        return chatMockImpl(prompt);
      }
      throw new Error("chatMockImpl not set");
    }
  }

  return {
    Agent: MockAgent,
    LocalAgentConfig: MockLocalAgentConfig,
    CapabilitiesConfig: MockCapabilitiesConfig,
    Text: MockText,
    Thought: MockThought,
    tool: (name: string, description: string, schema: any, execute: any) => {
      return { name, description, schema, execute };
    },
  };
});

import { Agent, Text, Thought } from "unofficial-antigravity-sdk";
import { createAntigravityRuntime } from "../src/runtime/antigravityRuntime";

function makeConfig(homeDir: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: "antigravity",
    model: "gemini-3.5-flash",
    preferredChildModel: "gemini-3.5-flash",
    workingDirectory: homeDir,
    outputDirectory: path.join(homeDir, "output"),
    uploadsDirectory: path.join(homeDir, "uploads"),
    userName: "",
    knowledgeCutoff: "unknown",
    projectCoworkDir: path.join(homeDir, ".agent-project"),
    userCoworkDir: path.join(homeDir, ".cowork"),
    builtInDir: homeDir,
    builtInConfigDir: path.join(homeDir, "config"),
    skillsDirs: [],
    memoryDirs: [],
    configDirs: [],
    providerOptions: {},
    ...overrides,
  };
}

function makeParams(
  config: AgentConfig,
  overrides: Partial<RuntimeRunTurnParams> = {},
): RuntimeRunTurnParams {
  return {
    config,
    system: "You are helpful.",
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    tools: {},
    maxSteps: 1,
    ...overrides,
  };
}

describe("antigravity runtime", () => {
  test("basic text response flows through runtime", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-test-"));
    const runtime = createAntigravityRuntime();

    (Agent as any).__setChatMockImpl(async (prompt: string) => {
      const chunks = [new Text(0, "Hello! "), new Text(0, "How can I help you?")];
      return {
        getChunks: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      };
    });

    const emittedParts: any[] = [];
    const params = makeParams(makeConfig(homeDir), {
      onModelStreamPart: (part) => {
        emittedParts.push(part);
      },
    });

    // Provide API Key via env to avoid throw
    process.env.GEMINI_API_KEY = "test-key";

    const result = await runtime.runTurn(params);

    expect(result.text).toBe("Hello! How can I help you?");
    expect(result.responseMessages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello! How can I help you?" }],
      },
    ]);
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });

    expect(emittedParts).toContainEqual({ type: "start" });
    expect(emittedParts).toContainEqual({ type: "text-start", id: "s0" });
    expect(emittedParts).toContainEqual({ type: "text-delta", id: "s0", text: "Hello! " });
    expect(emittedParts).toContainEqual({
      type: "text-delta",
      id: "s0",
      text: "How can I help you?",
    });
    expect(emittedParts).toContainEqual({ type: "text-end", id: "s0" });
    expect(emittedParts).toContainEqual({
      type: "finish",
      finishReason: "stop",
      totalUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });
  });

  test("thinking content is extracted as reasoningText", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-test-"));
    const runtime = createAntigravityRuntime();

    (Agent as any).__setChatMockImpl(async (prompt: string) => {
      const chunks = [new Thought(0, "Thinking..."), new Text(0, "Here is the response.")];
      return {
        getChunks: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 25,
          totalTokenCount: 40,
        },
      };
    });

    const emittedParts: any[] = [];
    const params = makeParams(makeConfig(homeDir), {
      onModelStreamPart: (part) => {
        emittedParts.push(part);
      },
    });

    process.env.GEMINI_API_KEY = "test-key";

    const result = await runtime.runTurn(params);

    expect(result.text).toBe("Here is the response.");
    expect(result.reasoningText).toBe("Thinking...");
    expect(result.responseMessages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Thinking..." },
          { type: "text", text: "Here is the response." },
        ],
      },
    ]);
  });

  test("tool calls trigger tool execution and multi-step loop", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-test-"));
    const runtime = createAntigravityRuntime();

    let toolExecuted = false;
    let toolInputReceived: any = null;

    (Agent as any).__setChatMockImpl(async (prompt: string) => {
      return {
        getChunks: async function* () {
          yield new Text(0, "Tool executed successfully.");
        },
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 30,
          totalTokenCount: 50,
        },
      };
    });

    const emittedParts: any[] = [];
    const params = makeParams(makeConfig(homeDir), {
      onModelStreamPart: (part) => {
        emittedParts.push(part);
      },
      tools: {
        testTool: {
          description: "A test tool",
          inputSchema: { type: "object", properties: { val: { type: "string" } } },
          execute: async (input: any) => {
            toolExecuted = true;
            toolInputReceived = input;
            return "tool result content";
          },
        },
      },
    });

    process.env.GEMINI_API_KEY = "test-key";
    const turnPromise = runtime.runTurn(params);

    await new Promise((r) => setTimeout(r, 50));

    const capturedAgent = (Agent as any).getLastInstance();
    expect(capturedAgent).toBeDefined();
    const testTool = capturedAgent.config.tools.find((t: any) => t.name === "testTool");
    expect(testTool).toBeDefined();

    const toolResult = await testTool.execute({ val: "hello-tool" });
    expect(toolResult).toBe("tool result content");
    expect(toolExecuted).toBe(true);
    expect(toolInputReceived).toEqual({ val: "hello-tool" });

    const result = await turnPromise;

    expect(result.text).toBe("Tool executed successfully.");
    expect(
      result.responseMessages.some(
        (m) => m.role === "assistant" && m.content.some((c: any) => c.type === "tool-call"),
      ),
    ).toBe(true);
    expect(
      result.responseMessages.some(
        (m) => m.role === "tool" && m.content.some((c: any) => c.type === "tool-result"),
      ),
    ).toBe(true);

    expect(emittedParts.some((p) => p.type === "tool-input-start")).toBe(true);
    expect(emittedParts.some((p) => p.type === "tool-input-end")).toBe(true);
    expect(emittedParts.some((p) => p.type === "tool-call")).toBe(true);
    expect(emittedParts.some((p) => p.type === "tool-result")).toBe(true);
  });
});
