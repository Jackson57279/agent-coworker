import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import { isCodexAppServerContinuationState } from "../shared/providerContinuation";
import type { ModelMessage } from "../types";
import { asRecord, asString } from "./piRuntimeOptions";
import type { LlmRuntime, RuntimeRunTurnParams, RuntimeRunTurnResult, RuntimeUsage } from "./types";

type JsonRpcResponse = {
  id: number | string;
  result?: unknown;
  error?: { message?: string; [key: string]: unknown };
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcRequest = {
  id: number | string;
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type CodexAppServerClient = {
  request: (method: string, params?: unknown) => Promise<unknown>;
  notify: (method: string, params?: unknown) => void;
  onNotification: (listener: (notification: JsonRpcNotification) => void) => () => void;
  close: () => Promise<void>;
};

const CODEX_APP_SERVER_PROVIDER = "codex-cli" as const;
const DEFAULT_CODEX_COMMAND = "codex";
const DEFAULT_CODEX_ARGS = ["app-server"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        const record = asRecord(item);
        return asString(record?.text) ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const record = asRecord(content);
  return asString(record?.text) ?? "";
}

function latestUserText(messages: readonly ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      const text = extractTextContent(message.content).trim();
      if (text) return text;
    }
  }
  return "";
}

function providerOptionString(
  providerOptions: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const root = asRecord(providerOptions);
  const codex = asRecord(root?.[CODEX_APP_SERVER_PROVIDER]);
  return asString(codex?.[key]);
}

function normalizeEffort(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value) ? value : undefined;
}

function normalizeSummary(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ["auto", "concise", "detailed", "none"].includes(value) ? value : undefined;
}

function parseUsage(value: unknown): RuntimeUsage | undefined {
  const record = asRecord(value);
  const total = asRecord(record?.total);
  const last = asRecord(record?.last) ?? total;
  const promptTokens = asNumber(last?.inputTokens) ?? asNumber(last?.input_tokens) ?? 0;
  const cachedPromptTokens =
    asNumber(last?.cachedInputTokens) ?? asNumber(last?.cached_input_tokens) ?? undefined;
  const completionTokens =
    asNumber(last?.outputTokens) ??
    asNumber(last?.output_tokens) ??
    asNumber(last?.reasoningOutputTokens) ??
    asNumber(last?.reasoning_output_tokens) ??
    0;
  const totalTokens =
    asNumber(last?.totalTokens) ??
    asNumber(last?.total_tokens) ??
    promptTokens + completionTokens + (cachedPromptTokens ?? 0);
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  };
}

function startCodexAppServer(params: RuntimeRunTurnParams): CodexAppServerClient {
  const command = process.env.COWORK_CODEX_APP_SERVER_COMMAND?.trim() || DEFAULT_CODEX_COMMAND;
  const args = process.env.COWORK_CODEX_APP_SERVER_ARGS?.trim().split(/\s+/).filter(Boolean) ?? [
    ...DEFAULT_CODEX_ARGS,
  ];
  const child = spawn(command, args, {
    cwd: params.config.workingDirectory,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number | string, PendingRequest>();
  const notificationListeners = new Set<(notification: JsonRpcNotification) => void>();
  let nextId = 1;
  let closed = false;

  const rejectAll = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  child.once("error", (error) => {
    rejectAll(new Error(`Failed to start codex app-server: ${error.message}`));
  });
  child.once("exit", (code, signal) => {
    closed = true;
    if (pending.size > 0) {
      rejectAll(
        new Error(`codex app-server exited before replying (code=${code}, signal=${signal})`),
      );
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) params.log?.(`[codex-app-server:stderr] ${text}`);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      params.log?.(`[codex-app-server] ignored invalid JSONL: ${String(error)}`);
      return;
    }

    const record = asRecord(message);
    if (!record) return;
    if ("id" in record && ("result" in record || "error" in record)) {
      const response = record as JsonRpcResponse;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) {
        request.reject(new Error(response.error.message || "codex app-server request failed"));
      } else {
        request.resolve(response.result);
      }
      return;
    }

    if ("id" in record && typeof record.method === "string") {
      handleServerRequest(child, record as JsonRpcRequest);
      return;
    }

    const notification = record as JsonRpcNotification;
    for (const listener of notificationListeners) listener(notification);
    void handleNotification(notification, params);
  });

  const write = (payload: unknown) => {
    if (closed || child.stdin.destroyed) {
      throw new Error("codex app-server is not running.");
    }
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    request: (method, requestParams) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
          write({ id, method, ...(requestParams !== undefined ? { params: requestParams } : {}) });
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    notify: (method, notificationParams) => {
      write({
        method,
        ...(notificationParams !== undefined ? { params: notificationParams } : {}),
      });
    },
    onNotification: (listener) => {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    close: async () => {
      rl.close();
      await stopProcess(child);
    },
  };
}

function handleServerRequest(child: ChildProcessWithoutNullStreams, request: JsonRpcRequest) {
  const method = request.method;
  let result: unknown = {};
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    result = { decision: "accept", acceptSettings: { forSession: true } };
  }
  child.stdin.write(`${JSON.stringify({ id: request.id, result })}\n`);
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function handleNotification(notification: JsonRpcNotification, params: RuntimeRunTurnParams) {
  const payload = asRecord(notification.params);
  const item = asRecord(payload?.item);
  switch (notification.method) {
    case "item/started":
      if (item?.type === "agentMessage") {
        await params.onModelStreamPart?.({ type: "text-start", id: item.id });
      } else if (item?.type === "reasoning") {
        await params.onModelStreamPart?.({ type: "reasoning-start", id: item.id });
      } else if (item?.type === "commandExecution") {
        await params.onModelStreamPart?.({
          type: "tool-call",
          toolCallId: asString(item.id),
          toolName: "commandExecution",
          input: { command: item.command, cwd: item.cwd },
          providerExecuted: true,
        });
      } else if (item?.type === "mcpToolCall") {
        await params.onModelStreamPart?.({
          type: "tool-call",
          toolCallId: asString(item.id),
          toolName: `${asString(item.server) ?? "mcp"}.${asString(item.tool) ?? "tool"}`,
          input: item.arguments ?? {},
          providerExecuted: true,
        });
      }
      break;
    case "item/agentMessage/delta":
      await params.onModelStreamPart?.({
        type: "text-delta",
        id: asString(payload?.itemId),
        text: asString(payload?.delta) ?? "",
      });
      break;
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      await params.onModelStreamPart?.({
        type: "reasoning-delta",
        id: asString(payload?.itemId),
        text: asString(payload?.delta) ?? "",
      });
      break;
    case "item/commandExecution/outputDelta":
      await params.onModelStreamPart?.({
        type: "tool-result",
        toolCallId: asString(payload?.itemId),
        toolName: "commandExecution",
        output: asString(payload?.delta) ?? "",
        providerExecuted: true,
      });
      break;
    case "item/completed":
      if (item?.type === "agentMessage") {
        await params.onModelStreamPart?.({ type: "text-end", id: item.id });
      } else if (item?.type === "reasoning") {
        await params.onModelStreamPart?.({ type: "reasoning-end", id: item.id });
      } else if (item?.type === "commandExecution") {
        await params.onModelStreamPart?.({
          type: item.status === "failed" ? "tool-error" : "tool-result",
          toolCallId: asString(item.id),
          toolName: "commandExecution",
          output: item.aggregatedOutput ?? "",
          error: item.status === "failed" ? (item.aggregatedOutput ?? "command failed") : undefined,
          providerExecuted: true,
        });
      } else if (item?.type === "mcpToolCall") {
        await params.onModelStreamPart?.({
          type: item.status === "failed" ? "tool-error" : "tool-result",
          toolCallId: asString(item.id),
          toolName: `${asString(item.server) ?? "mcp"}.${asString(item.tool) ?? "tool"}`,
          output: item.result ?? null,
          error: item.error ?? undefined,
          providerExecuted: true,
        });
      }
      break;
    case "error":
      await params.onModelStreamPart?.({ type: "error", error: payload?.error ?? payload });
      break;
  }

  await params.onModelRawEvent?.({
    format: "codex-app-server-v2",
    event: {
      method: notification.method,
      ...(payload ? { params: payload } : {}),
    },
  });
}

function assistantTextFromTurn(turn: unknown): string {
  const items = asArray(asRecord(turn)?.items);
  return items
    .map((item) => {
      const record = asRecord(item);
      return record?.type === "agentMessage" ? (asString(record.text) ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

function reasoningTextFromTurn(turn: unknown): string | undefined {
  const items = asArray(asRecord(turn)?.items);
  const text = items
    .flatMap((item) => {
      const record = asRecord(item);
      if (record?.type !== "reasoning") return [];
      return [...asArray(record.summary), ...asArray(record.content)].map((part) =>
        typeof part === "string" ? part : "",
      );
    })
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

export function createCodexAppServerRuntime(): LlmRuntime {
  return {
    name: "codex-app-server",
    runTurn: async (params): Promise<RuntimeRunTurnResult> => {
      const client = startCodexAppServer(params);
      let threadId: string | undefined;
      let usage: RuntimeUsage | undefined;
      try {
        params.abortSignal?.throwIfAborted();
        await client.request("initialize", {
          clientInfo: {
            name: "agent-coworker",
            title: "Agent Coworker",
            version: "0.1.0",
          },
        });
        client.notify("initialized");

        const currentState = isCodexAppServerContinuationState(params.providerState)
          ? params.providerState
          : null;
        const threadResult =
          currentState?.model === params.config.model
            ? await client.request("thread/resume", {
                threadId: currentState.threadId,
                cwd: params.config.workingDirectory,
                model: params.config.model,
                modelProvider: "openai",
                baseInstructions: params.system,
              })
            : await client.request("thread/start", {
                cwd: params.config.workingDirectory,
                model: params.config.model,
                modelProvider: "openai",
                approvalPolicy: "never",
                sandbox: "dangerFullAccess",
                baseInstructions: params.system,
                experimentalRawEvents: params.includeRawChunks ?? true,
              });
        const thread = asRecord(asRecord(threadResult)?.thread);
        threadId = asString(thread?.id);
        if (!threadId) throw new Error("codex app-server did not return a thread id.");

        await params.onModelStreamPart?.({
          type: "start",
          request: { model: params.config.model, provider: params.config.provider },
        });
        await params.onModelStreamPart?.({
          type: "start-step",
          stepNumber: 1,
          request: { model: params.config.model, provider: params.config.provider },
        });

        const userText = latestUserText(params.messages);
        if (!userText) throw new Error("codex app-server runtime requires a user message.");
        let startedTurnId: string | undefined;
        const completion = waitForTurnCompletion(
          client,
          () => startedTurnId,
          (nextUsage) => {
            usage = nextUsage;
          },
        );
        const turnResult = await client.request("turn/start", {
          threadId,
          input: [{ type: "text", text: userText, text_elements: [] }],
          cwd: params.config.workingDirectory,
          model: params.config.model,
          effort: normalizeEffort(providerOptionString(params.providerOptions, "reasoningEffort")),
          summary: normalizeSummary(
            providerOptionString(params.providerOptions, "reasoningSummary"),
          ),
        });

        const startedTurn = asRecord(asRecord(turnResult)?.turn);
        startedTurnId = asString(startedTurn?.id);
        const finalTurn = await completion;

        const text = assistantTextFromTurn(finalTurn);
        const reasoningText = reasoningTextFromTurn(finalTurn);
        await params.onModelStreamPart?.({
          type: "finish-step",
          stepNumber: 1,
          response: { stopReason: "stop" },
          usage,
          finishReason: "stop",
        });
        await params.onModelStreamPart?.({
          type: "finish",
          finishReason: "stop",
          totalUsage: usage,
        });

        return {
          text,
          ...(reasoningText ? { reasoningText } : {}),
          responseMessages: text ? [{ role: "assistant", content: text }] : [],
          ...(usage ? { usage } : {}),
          providerState: {
            provider: CODEX_APP_SERVER_PROVIDER,
            model: params.config.model,
            threadId,
            updatedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        if (params.abortSignal?.aborted) {
          await params.onModelAbort?.();
        } else {
          await params.onModelError?.(error);
        }
        throw error;
      } finally {
        await client.close();
      }
    },
  };
}

async function waitForTurnCompletion(
  client: CodexAppServerClient,
  turnId: string | (() => string | undefined),
  onUsage: (usage: RuntimeUsage | undefined) => void,
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        dispose();
        reject(new Error("Timed out waiting for codex app-server turn completion."));
      },
      30 * 60 * 1000,
    );
    const dispose = client.onNotification((notification) => {
      const params = asRecord(notification.params);
      if (notification.method === "thread/tokenUsage/updated") {
        onUsage(parseUsage(params?.tokenUsage));
        return;
      }
      if (notification.method !== "turn/completed") return;
      const turn = asRecord(params?.turn);
      const expectedTurnId = typeof turnId === "function" ? turnId() : turnId;
      if (expectedTurnId && asString(turn?.id) !== expectedTurnId) return;
      clearTimeout(timeout);
      dispose();
      if (turn?.status === "failed") {
        const error = asRecord(turn.error);
        reject(new Error(asString(error?.message) ?? "codex app-server turn failed."));
        return;
      }
      resolve(turn);
    });
  });
}
