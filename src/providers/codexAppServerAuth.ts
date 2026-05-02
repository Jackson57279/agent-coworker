import { asRecord, asString } from "../runtime/piRuntimeOptions";
import { openExternalUrl, type UrlOpener } from "../utils/browser";
import { type CodexAppServerClient, withCodexAppServerClient } from "./codexAppServerClient";

export type CodexAppServerAccount = {
  type: "apiKey" | "chatgpt";
  email?: string;
  planType?: string;
};

export type CodexAppServerRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt?: number;
};

export type CodexAppServerRateLimits = {
  primary?: CodexAppServerRateLimitWindow | null;
  secondary?: CodexAppServerRateLimitWindow | null;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string | number;
  } | null;
};

export type CodexAppServerModel = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
};

export type CodexAppServerApp = {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  logoUrlDark?: string;
  distributionChannel?: string;
  installUrl?: string;
  isAccessible: boolean;
  isEnabled: boolean;
  appMetadata?: Record<string, unknown>;
  labels?: Record<string, string>;
};

type ReadAccountOptions = {
  refreshToken?: boolean;
  log?: (line: string) => void;
};

type ReadRateLimitsOptions = {
  log?: (line: string) => void;
};

type LoginOptions = {
  openUrl?: UrlOpener;
  log?: (line: string) => void;
};

type ListModelsOptions = {
  log?: (line: string) => void;
};

type ListAppsOptions = {
  forceRefetch?: boolean;
  log?: (line: string) => void;
};

type SetAppEnabledOptions = {
  appId: string;
  enabled: boolean;
  log?: (line: string) => void;
};

type AppServerAuthOverrides = {
  readAccount?: (
    opts: ReadAccountOptions,
  ) => Promise<{ account: CodexAppServerAccount | null; requiresOpenaiAuth: boolean }>;
  readRateLimits?: (opts: ReadRateLimitsOptions) => Promise<CodexAppServerRateLimits | null>;
  login?: (opts: LoginOptions) => Promise<{ account: CodexAppServerAccount | null }>;
  listModels?: (opts: ListModelsOptions) => Promise<CodexAppServerModel[]>;
  listApps?: (opts: ListAppsOptions) => Promise<CodexAppServerApp[]>;
  setAppEnabled?: (opts: SetAppEnabledOptions) => Promise<void>;
};

const appServerAuthOverrides: AppServerAuthOverrides = {};

async function withClient<T>(
  fn: (client: CodexAppServerClient) => Promise<T>,
  log?: (line: string) => void,
): Promise<T> {
  return await withCodexAppServerClient(fn, { log });
}

function normalizeAccount(value: unknown): CodexAppServerAccount | null {
  const account = asRecord(value);
  const type = asString(account?.type);
  if (type === "apiKey") return { type };
  if (type === "chatgpt") {
    const email = asString(account?.email);
    const planType = asString(account?.planType);
    return {
      type,
      ...(email ? { email } : {}),
      ...(planType ? { planType } : {}),
    };
  }
  return null;
}

function normalizeModel(value: unknown): CodexAppServerModel | null {
  const model = asRecord(value);
  const id = asString(model?.id);
  const modelId = asString(model?.model);
  const canonicalId = modelId || id;
  if (!canonicalId) return null;
  const description = asString(model?.description);
  return {
    id: canonicalId,
    model: modelId || canonicalId,
    displayName: asString(model?.displayName) || canonicalId,
    ...(description ? { description } : {}),
    isDefault: model?.isDefault === true,
  };
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const text = asString(entry);
    if (text !== undefined) normalized[key] = text;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeApp(value: unknown): CodexAppServerApp | null {
  const app = asRecord(value);
  const id = asString(app?.id);
  const name = asString(app?.name);
  if (!id || !name) return null;
  const description = asString(app?.description);
  const logoUrl = asString(app?.logoUrl);
  const logoUrlDark = asString(app?.logoUrlDark);
  const distributionChannel = asString(app?.distributionChannel);
  const installUrl = asString(app?.installUrl);
  const appMetadata = asRecord(app?.appMetadata);
  const labels = normalizeStringRecord(app?.labels);
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(logoUrlDark ? { logoUrlDark } : {}),
    ...(distributionChannel ? { distributionChannel } : {}),
    ...(installUrl ? { installUrl } : {}),
    isAccessible: app?.isAccessible === true,
    isEnabled: app?.isEnabled === true,
    ...(appMetadata ? { appMetadata } : {}),
    ...(labels ? { labels } : {}),
  };
}

export async function listCodexAppServerModels(
  opts: ListModelsOptions = {},
): Promise<CodexAppServerModel[]> {
  if (appServerAuthOverrides.listModels) return await appServerAuthOverrides.listModels(opts);
  return await withClient(async (client) => {
    const models: CodexAppServerModel[] = [];
    let cursor: string | undefined;
    do {
      const result = asRecord(
        await client.request("model/list", {
          limit: 100,
          cursor: cursor ?? null,
        }),
      );
      const items = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.items)
          ? result.items
          : [];
      for (const item of items) {
        const model = normalizeModel(item);
        if (model) models.push(model);
      }
      cursor = asString(result?.nextCursor) ?? asString(result?.next_cursor);
    } while (cursor);
    return models;
  }, opts.log);
}

export async function listCodexAppServerApps(
  opts: ListAppsOptions = {},
): Promise<CodexAppServerApp[]> {
  if (appServerAuthOverrides.listApps) return await appServerAuthOverrides.listApps(opts);
  return await withClient(async (client) => {
    const apps: CodexAppServerApp[] = [];
    let cursor: string | undefined;
    do {
      const result = asRecord(
        await client.request("app/list", {
          limit: 100,
          cursor: cursor ?? null,
          forceRefetch: opts.forceRefetch === true,
        }),
      );
      const items = Array.isArray(result?.data) ? result.data : [];
      for (const item of items) {
        const app = normalizeApp(item);
        if (app) apps.push(app);
      }
      cursor = asString(result?.nextCursor) ?? asString(result?.next_cursor);
    } while (cursor);
    return apps;
  }, opts.log);
}

export async function setCodexAppServerAppEnabled(opts: SetAppEnabledOptions): Promise<void> {
  if (appServerAuthOverrides.setAppEnabled) {
    await appServerAuthOverrides.setAppEnabled(opts);
    return;
  }
  const appId = opts.appId.trim();
  if (!appId) throw new Error("App id is required.");
  await withClient(async (client) => {
    await client.request("config/value/write", {
      keyPath: `apps.${appId}.enabled`,
      value: opts.enabled,
      mergeStrategy: "upsert",
    });
  }, opts.log);
}

export async function readCodexAppServerAccount(
  opts: ReadAccountOptions,
): Promise<{ account: CodexAppServerAccount | null; requiresOpenaiAuth: boolean }> {
  if (appServerAuthOverrides.readAccount) return await appServerAuthOverrides.readAccount(opts);
  return await withClient(async (client) => {
    const result = asRecord(
      await client.request("account/read", { refreshToken: opts.refreshToken ?? false }),
    );
    return {
      account: normalizeAccount(result?.account),
      requiresOpenaiAuth: result?.requiresOpenaiAuth === true,
    };
  }, opts.log);
}

export async function readCodexAppServerRateLimits(
  opts: ReadRateLimitsOptions,
): Promise<CodexAppServerRateLimits | null> {
  if (appServerAuthOverrides.readRateLimits) {
    return await appServerAuthOverrides.readRateLimits(opts);
  }
  return await withClient(async (client) => {
    const result = asRecord(await client.request("account/rateLimits/read"));
    return (asRecord(result?.rateLimits) as CodexAppServerRateLimits | null) ?? null;
  }, opts.log);
}

export async function loginCodexAppServerChatGpt(
  opts: LoginOptions,
): Promise<{ account: CodexAppServerAccount | null }> {
  if (appServerAuthOverrides.login) return await appServerAuthOverrides.login(opts);
  return await withClient(async (client) => {
    const started = asRecord(await client.request("account/login/start", { type: "chatgpt" }));
    const authUrl = asString(started?.authUrl);
    const loginId = asString(started?.loginId);
    if (!authUrl || !loginId) {
      throw new Error("codex app-server did not return a ChatGPT login URL.");
    }
    opts.log?.("[auth] opening Codex app-server ChatGPT login URL.");
    await (opts.openUrl ?? openExternalUrl)(authUrl);
    await waitForLogin(client, loginId);
    const result = asRecord(await client.request("account/read", { refreshToken: true }));
    return {
      account: normalizeAccount(result?.account),
    };
  }, opts.log);
}

export const __internal = {
  setAuthOverridesForTests(overrides: AppServerAuthOverrides): void {
    appServerAuthOverrides.readAccount = overrides.readAccount;
    appServerAuthOverrides.readRateLimits = overrides.readRateLimits;
    appServerAuthOverrides.login = overrides.login;
    appServerAuthOverrides.listModels = overrides.listModels;
    appServerAuthOverrides.listApps = overrides.listApps;
    appServerAuthOverrides.setAppEnabled = overrides.setAppEnabled;
  },
  resetAuthOverridesForTests(): void {
    delete appServerAuthOverrides.readAccount;
    delete appServerAuthOverrides.readRateLimits;
    delete appServerAuthOverrides.login;
    delete appServerAuthOverrides.listModels;
    delete appServerAuthOverrides.listApps;
    delete appServerAuthOverrides.setAppEnabled;
  },
} as const;

async function waitForLogin(client: CodexAppServerClient, loginId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        dispose();
        reject(new Error("Timed out waiting for Codex app-server login."));
      },
      10 * 60 * 1000,
    );
    const dispose = client.onNotification((notification) => {
      if (notification.method !== "account/login/completed") return;
      const params = asRecord(notification.params);
      if (asString(params?.loginId) !== loginId) return;
      clearTimeout(timeout);
      dispose();
      if (params?.success === true) {
        resolve();
      } else {
        reject(new Error(asString(params?.error) ?? "Codex app-server login failed."));
      }
    });
  });
}
