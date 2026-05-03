import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import { asRecord, asString } from "../runtime/piRuntimeOptions";
import { VERSION } from "../version";
import {
  type CodexAppServerCommand,
  resolveCodexAppServerCommand,
  spawnCodexAppServer,
} from "./codexAppServerResolver";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CodexAppServerJsonRpcDirection =
  | "client_request"
  | "client_notification"
  | "client_response"
  | "server_request"
  | "server_notification"
  | "server_response";

export type CodexAppServerJsonRpcRawMessage = {
  direction: CodexAppServerJsonRpcDirection;
  message: Record<string, unknown>;
};

export type CodexAppServerJsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type CodexAppServerJsonRpcRequest = {
  id: number | string;
  method: string;
  params?: unknown;
};

export type CodexAppServerClient = {
  command: CodexAppServerCommand;
  request: (method: string, params?: unknown) => Promise<unknown>;
  notify: (method: string, params?: unknown) => void;
  onNotification: (
    listener: (notification: CodexAppServerJsonRpcNotification) => void,
  ) => () => void;
  close: () => Promise<void>;
};

export type CodexAppServerRequestHandler = (
  request: CodexAppServerJsonRpcRequest,
) => Promise<unknown> | unknown;

export type CodexAppServerClientOptions = {
  cwd?: string;
  log?: (line: string) => void;
  invalidJsonLogPrefix?: string;
  onServerRequest?: CodexAppServerRequestHandler;
  onJsonRpcMessage?: (message: CodexAppServerJsonRpcRawMessage) => void;
};

export function codexAppServerClientInfo(): { name: string; title: string; version: string } {
  return {
    name: "agent-coworker",
    title: "Agent Coworker",
    version: VERSION,
  };
}

export function codexAppServerInitializeParams(): {
  clientInfo: ReturnType<typeof codexAppServerClientInfo>;
  capabilities: { experimentalApi: boolean };
} {
  return {
    clientInfo: codexAppServerClientInfo(),
    capabilities: { experimentalApi: true },
  };
}

export async function startCodexAppServerClient(
  opts: CodexAppServerClientOptions = {},
): Promise<CodexAppServerClient> {
  const command = await resolveCodexAppServerCommand();
  const child = spawnCodexAppServer(command, { cwd: opts.cwd, env: process.env });
  const pending = new Map<number | string, PendingRequest>();
  const listeners = new Set<(notification: CodexAppServerJsonRpcNotification) => void>();
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
    if (text) opts.log?.(`[codex-app-server:stderr] ${text}`);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (opts.invalidJsonLogPrefix) {
        opts.log?.(`${opts.invalidJsonLogPrefix}: ${String(error)}`);
      } else {
        opts.log?.(`[codex-app-server:stdout] ${line}`);
      }
      return;
    }

    const record = asRecord(parsed);
    if (!record) return;
    if ("id" in record && ("result" in record || "error" in record)) {
      opts.onJsonRpcMessage?.({ direction: "server_response", message: record });
      const id = record.id as number | string;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      const error = asRecord(record.error);
      if (error) {
        request.reject(new Error(asString(error.message) ?? "codex app-server request failed"));
      } else {
        request.resolve(record.result);
      }
      return;
    }

    if ("id" in record && typeof record.method === "string") {
      opts.onJsonRpcMessage?.({ direction: "server_request", message: record });
      void respondToServerRequest(
        child,
        record as CodexAppServerJsonRpcRequest,
        opts.onServerRequest,
        opts.onJsonRpcMessage,
      );
      return;
    }

    const notification = record as CodexAppServerJsonRpcNotification;
    opts.onJsonRpcMessage?.({ direction: "server_notification", message: record });
    for (const listener of listeners) listener(notification);
  });

  const write = (payload: Record<string, unknown>, direction: CodexAppServerJsonRpcDirection) => {
    if (closed || child.stdin.destroyed) throw new Error("codex app-server is not running.");
    opts.onJsonRpcMessage?.({ direction, message: payload });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    command,
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
          write({ id, method, ...(params !== undefined ? { params } : {}) }, "client_request");
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    notify: (method, params) => {
      write({ method, ...(params !== undefined ? { params } : {}) }, "client_notification");
    },
    onNotification: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => {
      rl.close();
      await stopProcess(child);
    },
  };
}

async function respondToServerRequest(
  child: ChildProcessWithoutNullStreams,
  request: CodexAppServerJsonRpcRequest,
  handler: CodexAppServerRequestHandler | undefined,
  onJsonRpcMessage: ((message: CodexAppServerJsonRpcRawMessage) => void) | undefined,
) {
  try {
    const result = handler ? await handler(request) : {};
    const response = { id: request.id, result: result ?? {} };
    onJsonRpcMessage?.({ direction: "client_response", message: response });
    child.stdin.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response = {
      id: request.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    onJsonRpcMessage?.({ direction: "client_response", message: response });
    child.stdin.write(`${JSON.stringify(response)}\n`);
  }
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

export async function withCodexAppServerClient<T>(
  fn: (client: CodexAppServerClient) => Promise<T>,
  opts: CodexAppServerClientOptions = {},
): Promise<T> {
  const client = await startCodexAppServerClient(opts);
  try {
    await client.request("initialize", codexAppServerInitializeParams());
    client.notify("initialized");
    return await fn(client);
  } finally {
    await client.close();
  }
}
