import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentConfig } from "../types";

const TITLE_MODELS_BY_PROVIDER: Partial<Record<AgentConfig["provider"], readonly string[]>> = {
  antigravity: ["gemini-3.1-flash-lite"],
  anthropic: ["claude-haiku-4-5"],
  baseten: ["moonshotai/Kimi-K2.5"],
  "codex-cli": ["gpt-5.4-mini", "gpt-5.3-codex-spark"],
  google: ["gemini-3-flash-preview"],
  nvidia: ["nvidia/nemotron-3-super-120b-a12b"],
  openai: ["gpt-5-mini"],
  together: ["moonshotai/Kimi-K2.5"],
  fireworks: ["accounts/fireworks/models/glm-5"],
  "opencode-go": ["glm-5"],
  "opencode-zen": ["glm-5"],
};

const TITLE_MAX_TOKENS = 150;
const TITLE_MAX_CHARS = 50;
const APPLE_FOUNDATION_TITLE_MODEL = "SystemLanguageModel";
const APPLE_MODEL_NOT_READY_REASON = 2;
const APPLE_TITLE_WAIT_TIMEOUT_MS = 1_000;
const APPLE_TITLE_WAIT_INTERVAL_MS = 100;
const APPLE_TITLE_MAX_RESPONSE_TOKENS = 24;

export const DEFAULT_SESSION_TITLE = "New session";

export type SessionTitleSource = "default" | "model" | "heuristic" | "manual";

export type SessionTitleResult = {
  title: string;
  source: SessionTitleSource;
  model: string | null;
};

type SessionTitleDeps = {
  createRuntime: typeof import("../runtime").createRuntime;
  defaultModelForProvider: typeof import("../providers/catalog").defaultModelForProvider;
  loadAppleFoundationModelsModule: (env: NodeJS.ProcessEnv) => Promise<AppleFoundationModelsModule>;
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
};

type AppleFoundationAvailability = {
  available: boolean;
  reason?: number;
};

type AppleFoundationSystemLanguageModel = {
  isAvailable: () => AppleFoundationAvailability;
  waitUntilAvailable?: (
    timeoutMs?: number,
    intervalMs?: number,
  ) => Promise<AppleFoundationAvailability>;
  dispose: () => void;
};

type AppleFoundationLanguageModelSession = {
  respond: (
    prompt: string,
    opts?: {
      options?: {
        sampling?: unknown;
        maximumResponseTokens?: number;
        temperature?: number;
      };
    },
  ) => Promise<string>;
  dispose: () => void;
};

type AppleFoundationModelsModule = {
  SystemLanguageModel: new () => AppleFoundationSystemLanguageModel;
  LanguageModelSession: new (opts?: {
    model?: AppleFoundationSystemLanguageModel;
    instructions?: string;
  }) => AppleFoundationLanguageModelSession;
  SamplingMode?: {
    greedy?: () => unknown;
  };
};

type AppleFoundationTitleAttempt =
  | { status: "generated"; title: string }
  | { status: "unavailable" }
  | { status: "failed" };

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripWrappingQuotes(value: string): string {
  const wrappedPairs: Array<[start: string, end: string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
    ['\\"', '\\"'],
    ["\\'", "\\'"],
    ["\\`", "\\`"],
  ];

  let current = value.trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [start, end] of wrappedPairs) {
      if (current.length <= start.length + end.length) continue;
      if (!current.startsWith(start) || !current.endsWith(end)) continue;
      current = current.slice(start.length, current.length - end.length).trim();
      changed = true;
      break;
    }
  }

  return current;
}

function limitTokenCount(value: string, maxTokens: number): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length <= maxTokens) return value;
  return tokens.slice(0, maxTokens).join(" ");
}

function truncateToCharLimit(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars).replace(/\s+\S*$/, "");
  return `${(truncated || value.slice(0, maxChars)).trimEnd()}…`;
}

function sanitizeModelTitle(value: string): string {
  const compact = collapseWhitespace(stripWrappingQuotes(value));
  if (!compact) return "";
  const tokenBound = limitTokenCount(compact, TITLE_MAX_TOKENS).trim();
  return truncateToCharLimit(tokenBound, TITLE_MAX_CHARS);
}

export function heuristicTitleFromQuery(query: string): string {
  const compact = collapseWhitespace(stripWrappingQuotes(query));
  if (!compact) return DEFAULT_SESSION_TITLE;

  const withoutTrailingPunctuation = compact.replace(/[.!?]+$/g, "").trim();
  const tokenBound = limitTokenCount(withoutTrailingPunctuation || compact, TITLE_MAX_TOKENS);
  const charBound =
    tokenBound.length > TITLE_MAX_CHARS
      ? truncateToCharLimit(tokenBound, TITLE_MAX_CHARS)
      : tokenBound;
  return charBound || DEFAULT_SESSION_TITLE;
}

function modelCandidatesForProvider(
  provider: AgentConfig["provider"],
  currentModel: string,
  defaultModelForProviderImpl: SessionTitleDeps["defaultModelForProvider"],
): string[] {
  const titleModels = TITLE_MODELS_BY_PROVIDER[provider];
  const candidates = [...(titleModels ?? []), currentModel, defaultModelForProviderImpl(provider)];

  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || unique.includes(candidate)) continue;
    unique.push(candidate);
  }
  return unique;
}

function buildTitlePrompt(query: string): string {
  return [
    "Generate a brief title that would help the user find this conversation later.",
    "",
    "Rules:",
    `- Single line, maximum ${TITLE_MAX_CHARS} characters`,
    "- No surrounding quotes or explanations",
    "- Grammatically correct",
    "- NEVER include tool names or technical jargon about the AI",
    "- Focus on the main topic and user intent",
    "- Vary phrasing to avoid repetitive patterns",
    "- When a file is mentioned, focus on WHAT the user wants to do WITH it",
    "",
    `User request: ${query}`,
  ].join("\n");
}

function providerOptionsForTitleRun(config: AgentConfig): AgentConfig["providerOptions"] {
  const options = config.providerOptions;
  if (config.provider !== "codex-cli" && config.provider !== "openai") return options;

  const currentOptions = options?.[config.provider];
  const titleOptions =
    currentOptions && typeof currentOptions === "object" && !Array.isArray(currentOptions)
      ? { ...(currentOptions as Record<string, unknown>) }
      : {};
  titleOptions.reasoningEffort = "low";
  if (config.provider === "codex-cli") {
    delete titleOptions.reasoningSummary;
  }
  return {
    ...options,
    [config.provider]: titleOptions,
  };
}

function isAppleSiliconMac(platform: NodeJS.Platform, arch: string): boolean {
  return platform === "darwin" && arch === "arm64";
}

async function loadAppleFoundationModelsModule(
  env: NodeJS.ProcessEnv,
): Promise<AppleFoundationModelsModule> {
  const packagedSdkDir = env.COWORK_TSFMSDK_DIR?.trim();
  if (packagedSdkDir) {
    const indexUrl = pathToFileURL(path.join(packagedSdkDir, "dist", "index.js")).href;
    return (await import(indexUrl)) as AppleFoundationModelsModule;
  }

  const packageName = "tsfm-" + "sdk";
  return (await import(packageName)) as AppleFoundationModelsModule;
}

async function resolveAppleModelAvailability(
  model: AppleFoundationSystemLanguageModel,
): Promise<AppleFoundationAvailability> {
  const availability = model.isAvailable();
  if (
    !availability.available &&
    availability.reason === APPLE_MODEL_NOT_READY_REASON &&
    typeof model.waitUntilAvailable === "function"
  ) {
    return await model.waitUntilAvailable(
      APPLE_TITLE_WAIT_TIMEOUT_MS,
      APPLE_TITLE_WAIT_INTERVAL_MS,
    );
  }
  return availability;
}

async function generateAppleFoundationTitle(
  query: string,
  deps: Pick<SessionTitleDeps, "arch" | "env" | "loadAppleFoundationModelsModule" | "platform">,
): Promise<AppleFoundationTitleAttempt> {
  if (!isAppleSiliconMac(deps.platform, deps.arch)) {
    return { status: "unavailable" };
  }

  let appleModule: AppleFoundationModelsModule;
  try {
    appleModule = await deps.loadAppleFoundationModelsModule(deps.env);
  } catch {
    return { status: "unavailable" };
  }

  let model: AppleFoundationSystemLanguageModel | null = null;
  try {
    model = new appleModule.SystemLanguageModel();
    const availability = await resolveAppleModelAvailability(model);
    if (!availability.available) {
      model.dispose();
      return { status: "unavailable" };
    }
  } catch {
    model?.dispose();
    return { status: "unavailable" };
  }

  let session: AppleFoundationLanguageModelSession | null = null;
  try {
    session = new appleModule.LanguageModelSession({
      model,
      instructions:
        "You generate concise session titles. Return title text only, without quotes or extra explanation.",
    });
    const sampling = appleModule.SamplingMode?.greedy?.();
    const result = await session.respond(buildTitlePrompt(query), {
      options: {
        ...(sampling ? { sampling } : {}),
        maximumResponseTokens: APPLE_TITLE_MAX_RESPONSE_TOKENS,
      },
    });
    const title = sanitizeModelTitle(result);
    return title ? { status: "generated", title } : { status: "failed" };
  } catch {
    return { status: "failed" };
  } finally {
    session?.dispose();
    model.dispose();
  }
}

export function createSessionTitleGenerator(overrides: Partial<SessionTitleDeps> = {}) {
  let lazyDepsPromise: Promise<SessionTitleDeps> | null = null;

  const getDeps = async (): Promise<SessionTitleDeps> => {
    if (overrides.createRuntime && overrides.defaultModelForProvider) {
      return {
        createRuntime: overrides.createRuntime,
        defaultModelForProvider: overrides.defaultModelForProvider,
        loadAppleFoundationModelsModule:
          overrides.loadAppleFoundationModelsModule ?? loadAppleFoundationModelsModule,
        platform: overrides.platform ?? process.platform,
        arch: overrides.arch ?? process.arch,
        env: overrides.env ?? process.env,
      };
    }

    if (!lazyDepsPromise) {
      lazyDepsPromise = Promise.all([import("../runtime"), import("../providers/catalog")]).then(
        ([runtime, catalog]) => ({
          createRuntime: overrides.createRuntime ?? runtime.createRuntime,
          defaultModelForProvider:
            overrides.defaultModelForProvider ?? catalog.defaultModelForProvider,
          loadAppleFoundationModelsModule:
            overrides.loadAppleFoundationModelsModule ?? loadAppleFoundationModelsModule,
          platform: overrides.platform ?? process.platform,
          arch: overrides.arch ?? process.arch,
          env: overrides.env ?? process.env,
        }),
      );
    }

    return await lazyDepsPromise;
  };

  return async function generateSessionTitle(opts: {
    config: AgentConfig;
    query: string;
  }): Promise<SessionTitleResult> {
    const query = collapseWhitespace(opts.query);
    if (!query) {
      return {
        title: DEFAULT_SESSION_TITLE,
        source: "default",
        model: null,
      };
    }

    const deps = await getDeps();
    const appleTitle = await generateAppleFoundationTitle(query, deps);
    if (appleTitle.status === "generated") {
      return {
        title: appleTitle.title,
        source: "model",
        model: APPLE_FOUNDATION_TITLE_MODEL,
      };
    }
    if (appleTitle.status === "failed") {
      return {
        title: heuristicTitleFromQuery(query),
        source: "heuristic",
        model: null,
      };
    }

    const isAntigravity = opts.config.provider === "antigravity";
    const candidates = isAntigravity
      ? ["gemini-3.1-flash-lite-preview"]
      : modelCandidatesForProvider(
          opts.config.provider,
          opts.config.model,
          deps.defaultModelForProvider,
        );

    for (const modelId of candidates) {
      try {
        const runtimeConfig: AgentConfig = {
          ...opts.config,
          provider: isAntigravity ? "google" : opts.config.provider,
          model: modelId,
        };
        const runtime = deps.createRuntime(runtimeConfig);
        const result = await runtime.runTurn({
          config: runtimeConfig,
          system:
            "You generate concise session titles. Return title text only, without quotes or extra explanation.",
          messages: [{ role: "user", content: buildTitlePrompt(query) }],
          tools: {},
          maxSteps: 1,
          providerOptions: providerOptionsForTitleRun(runtimeConfig),
        });

        const title = sanitizeModelTitle(result.text);
        if (!title) continue;

        return {
          title,
          source: "model",
          model: modelId,
        };
      } catch {
        // fall through to next candidate
      }
    }

    return {
      title: heuristicTitleFromQuery(query),
      source: "heuristic",
      model: null,
    };
  };
}

export const generateSessionTitle = createSessionTitleGenerator();

export const __internal = {
  APPLE_FOUNDATION_TITLE_MODEL,
  generateAppleFoundationTitle,
  isAppleSiliconMac,
  loadAppleFoundationModelsModule,
};
