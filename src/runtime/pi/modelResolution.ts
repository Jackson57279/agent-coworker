import { getSavedProviderApiKey } from "../../config";
import { getResolvedModelMetadataSync } from "../../models/metadata";
import { getBasetenModelSpec, resolveBasetenApiKey } from "../../providers/basetenShared";
import { bedrockClientConfig, resolveBedrockAuthConfig } from "../../providers/bedrockShared";
import {
  getFireworksInferenceModelSpec,
  isFireworksInferenceProvider,
  resolveFireworksInferenceApiKey,
} from "../../providers/fireworksShared";
import { prepareLmStudioModelMetadataForInference } from "../../providers/lmstudio/catalog";
import { lmStudioOpenAiBaseUrl } from "../../providers/lmstudio/client";
import { getNvidiaModelSpec, resolveNvidiaApiKey } from "../../providers/nvidiaShared";
import {
  getOpenCodeModelPricing,
  getOpenCodeModelSpec,
  getOpenCodeProviderConfig,
  isOpenCodeModelSupportedByProvider,
  isOpenCodeProviderName,
  type OpenCodeProviderName,
  resolveOpenCodeApiKey,
} from "../../providers/opencodeShared";
import { getTogetherModelSpec, resolveTogetherApiKey } from "../../providers/togetherShared";
import type { ProviderName } from "../../types";
import { asRecord, type PiModel, pickKnownPiModel } from "../piRuntimeOptions";
import type { RuntimeRunTurnParams } from "../types";
import {
  LM_STUDIO_LOCAL_SENTINEL_API_KEY,
  PI_PLACEHOLDER_COST,
  type ResolvedPiRuntimeModel,
} from "./types";

export function preparePiModelForStream(model: PiModel): PiModel {
  if (model.cost) return model;
  return {
    ...model,
    cost: { ...PI_PLACEHOLDER_COST },
  };
}

export function stripPlaceholderCostFromAssistantRecord(
  assistant: Record<string, unknown>,
  model: PiModel,
): Record<string, unknown> {
  if (model.cost) return assistant;
  const usage = asRecord(assistant.usage);
  if (!usage || !("cost" in usage)) return assistant;
  const nextUsage = { ...usage };
  delete nextUsage.cost;
  return {
    ...assistant,
    usage: nextUsage,
  };
}

function applySupportedModelMetadata(
  model: PiModel,
  provider: ProviderName,
  modelId: string,
): PiModel {
  const supported = getResolvedModelMetadataSync(provider, modelId, "model");
  const input: Array<"text" | "image"> = supported.supportsImageInput
    ? ["text", "image"]
    : ["text"];
  return {
    ...model,
    id: supported.id,
    name: supported.displayName,
    input,
  };
}

function safeLmStudioMaxTokens(contextWindow: number): number {
  return Math.max(1, Math.floor(contextWindow / 4));
}

function buildLmStudioPiModel(opts: {
  metadata: ReturnType<typeof getResolvedModelMetadataSync>;
  baseUrl: string;
}): PiModel {
  const contextWindow =
    opts.metadata.effectiveContextLength ?? opts.metadata.maxContextLength ?? 8192;
  return {
    id: opts.metadata.id,
    name: opts.metadata.displayName,
    api: "openai-completions",
    provider: "lmstudio",
    baseUrl: lmStudioOpenAiBaseUrl(opts.baseUrl),
    reasoning: false,
    input: opts.metadata.supportsImageInput ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens: safeLmStudioMaxTokens(contextWindow),
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "openai",
    },
  };
}

function getOpenCodePiModel(provider: OpenCodeProviderName, modelId: string): PiModel | null {
  if (!isOpenCodeModelSupportedByProvider(provider, modelId)) return null;
  const modelSpec = getOpenCodeModelSpec(modelId);
  if (!modelSpec) return null;
  const pricing = getOpenCodeModelPricing(provider, modelId);

  const providerConfig = getOpenCodeProviderConfig(provider);
  return {
    id: modelSpec.id,
    name: modelSpec.name,
    api: "openai-completions",
    provider: "opencode",
    baseUrl: providerConfig.baseUrl,
    reasoning: modelSpec.reasoning,
    input: [...modelSpec.input],
    ...(pricing
      ? {
          cost: {
            input: pricing.input,
            output: pricing.output,
            cacheRead: pricing.cacheRead,
            cacheWrite: pricing.cacheWrite,
          },
        }
      : {}),
    contextWindow: modelSpec.contextWindow,
    maxTokens: modelSpec.maxTokens,
  };
}

function getBasetenPiModel(modelId: string): PiModel | null {
  const modelSpec = getBasetenModelSpec(modelId);
  if (!modelSpec) return null;

  return {
    id: modelSpec.id,
    name: modelSpec.name,
    api: "openai-completions",
    provider: "baseten",
    baseUrl: modelSpec.baseUrl,
    reasoning: modelSpec.reasoning,
    input: [...modelSpec.input],
    ...(modelSpec.pricing
      ? {
          cost: {
            input: modelSpec.pricing.input,
            output: modelSpec.pricing.output,
            cacheRead: modelSpec.pricing.cacheRead ?? 0,
            cacheWrite: modelSpec.pricing.cacheWrite ?? 0,
          },
        }
      : {}),
    contextWindow: modelSpec.contextWindow,
    maxTokens: modelSpec.maxTokens,
  };
}

function getBedrockPiModel(modelId: string): PiModel {
  const model = pickKnownPiModel("amazon-bedrock", modelId);
  if (model) {
    return {
      ...model,
      api: "bedrock-converse-stream",
      provider: "amazon-bedrock",
    };
  }

  return {
    id: modelId,
    name: modelId,
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    baseUrl: "https://bedrock-runtime",
    reasoning: modelId.toLowerCase().includes("claude"),
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 8_192,
  };
}

function getTogetherPiModel(modelId: string): PiModel | null {
  const modelSpec = getTogetherModelSpec(modelId);
  if (!modelSpec) return null;

  return {
    id: modelSpec.id,
    name: modelSpec.name,
    api: "openai-completions",
    provider: "together",
    baseUrl: modelSpec.baseUrl,
    reasoning: modelSpec.reasoning,
    input: [...modelSpec.input],
    cost: {
      input: modelSpec.pricing.input,
      output: modelSpec.pricing.output,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: modelSpec.contextWindow,
    maxTokens: modelSpec.maxTokens,
  };
}

function getFireworksInferencePiModel(
  provider: "fireworks" | "firepass",
  modelId: string,
): PiModel | null {
  const modelSpec = getFireworksInferenceModelSpec(provider, modelId);
  if (!modelSpec) return null;

  return {
    id: modelSpec.id,
    name: modelSpec.name,
    api: "openai-completions",
    provider,
    baseUrl: modelSpec.baseUrl,
    reasoning: modelSpec.reasoning,
    input: [...modelSpec.input],
    cost: {
      input: modelSpec.pricing.input,
      output: modelSpec.pricing.output,
      cacheRead: modelSpec.pricing.cacheRead ?? 0,
      cacheWrite: modelSpec.pricing.cacheWrite ?? 0,
    },
    contextWindow: modelSpec.contextWindow,
    maxTokens: modelSpec.maxTokens,
  };
}

function getNvidiaPiModel(modelId: string): PiModel | null {
  const modelSpec = getNvidiaModelSpec(modelId);
  if (!modelSpec) return null;

  return {
    id: modelSpec.id,
    name: modelSpec.name,
    api: "openai-completions",
    provider: "nvidia",
    baseUrl: modelSpec.baseUrl,
    reasoning: modelSpec.reasoning,
    input: [...modelSpec.input],
    contextWindow: modelSpec.contextWindow,
    maxTokens: modelSpec.maxTokens,
    compat: { ...modelSpec.compat },
  };
}

function isNvidiaChatCompletionsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://integrate.api.nvidia.com" && url.pathname === "/v1/chat/completions"
    );
  } catch {
    return false;
  }
}

export function normalizeNvidiaChatCompletionsBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  delete next.store;
  delete next.max_tokens;
  delete next.max_completion_tokens;
  delete next.reasoning_budget;
  delete next.reasoning_effort;
  delete next.enable_thinking;

  const chatTemplateKwargs = asRecord(body.chat_template_kwargs) ?? {};
  next.chat_template_kwargs = {
    ...chatTemplateKwargs,
    enable_thinking: true,
  };
  return next;
}

function requestUrlFromFetchInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function decodeRequestBody(body: BodyInit | null | undefined): string | null {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return null;
}

async function maybeRewriteNvidiaFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<[RequestInfo | URL, RequestInit | undefined]> {
  const url = requestUrlFromFetchInput(input);
  if (!isNvidiaChatCompletionsUrl(url)) {
    return [input, init];
  }

  let rawBody = decodeRequestBody(init?.body);
  if (!rawBody && input instanceof Request && init?.body === undefined) {
    rawBody = await input.clone().text();
  }
  if (!rawBody) {
    return [input, init];
  }

  let parsedBody: Record<string, unknown> | null = null;
  try {
    parsedBody = asRecord(JSON.parse(rawBody));
  } catch {
    parsedBody = null;
  }
  if (!parsedBody) {
    return [input, init];
  }

  const rewrittenBody = JSON.stringify(normalizeNvidiaChatCompletionsBody(parsedBody));
  if (input instanceof Request && init === undefined) {
    return [new Request(input, { body: rewrittenBody }), undefined];
  }
  return [input, { ...(init ?? {}), body: rewrittenBody }];
}

const NVIDIA_FETCH_PATCH_STATE = Symbol.for("cowork.nvidia.fetchPatchState");

type NvidiaFetchPatchState = {
  refCount: number;
  originalFetch: typeof fetch;
};

export async function withPatchedNvidiaFetch<T>(run: () => Promise<T>): Promise<T> {
  const globalWithState = globalThis as typeof globalThis & {
    [NVIDIA_FETCH_PATCH_STATE]?: NvidiaFetchPatchState;
  };
  const existingState = globalWithState[NVIDIA_FETCH_PATCH_STATE];
  if (existingState) {
    existingState.refCount += 1;
    try {
      return await run();
    } finally {
      existingState.refCount -= 1;
      if (existingState.refCount === 0) {
        globalThis.fetch = existingState.originalFetch;
        delete globalWithState[NVIDIA_FETCH_PATCH_STATE];
      }
    }
  }

  const originalFetch = globalThis.fetch;
  const wrappedFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = await maybeRewriteNvidiaFetchRequest(input, init);
    return originalFetch.call(globalThis, nextInput as any, nextInit as any);
  }, originalFetch);

  globalThis.fetch = wrappedFetch as typeof fetch;
  globalWithState[NVIDIA_FETCH_PATCH_STATE] = {
    refCount: 1,
    originalFetch,
  };

  try {
    return await run();
  } finally {
    const currentState = globalWithState[NVIDIA_FETCH_PATCH_STATE];
    if (currentState) {
      currentState.refCount -= 1;
      if (currentState.refCount === 0) {
        globalThis.fetch = currentState.originalFetch;
        delete globalWithState[NVIDIA_FETCH_PATCH_STATE];
      }
    }
  }
}

export async function resolvePiModel(
  params: RuntimeRunTurnParams,
): Promise<ResolvedPiRuntimeModel> {
  const modelId = params.config.model;
  const provider = params.config.provider;

  if (provider === "openai") {
    const model = pickKnownPiModel("openai", modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider openai (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: getSavedProviderApiKey(params.config, "openai"),
    };
  }

  if (provider === "google") {
    throw new Error(
      "Google is handled by the Google Interactions runtime. Set runtime to 'google-interactions'.",
    );
  }

  if (provider === "anthropic") {
    const model = pickKnownPiModel("anthropic", modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider anthropic (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: getSavedProviderApiKey(params.config, "anthropic"),
    };
  }

  if (provider === "bedrock") {
    const auth = await resolveBedrockAuthConfig({ config: params.config });
    const streamOptions = auth ? bedrockClientConfig(auth) : undefined;
    return {
      model: applySupportedModelMetadata(getBedrockPiModel(modelId), provider, modelId),
      ...(streamOptions ? { streamOptions } : {}),
    };
  }

  if (provider === "baseten") {
    const model = getBasetenPiModel(modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider baseten (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: resolveBasetenApiKey({
        savedKey: getSavedProviderApiKey(params.config, "baseten"),
      }),
    };
  }

  if (provider === "together") {
    const model = getTogetherPiModel(modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider together (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: resolveTogetherApiKey({
        savedKey: getSavedProviderApiKey(params.config, "together"),
      }),
    };
  }

  if (isFireworksInferenceProvider(provider)) {
    const model = getFireworksInferencePiModel(provider, modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider ${provider} (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: resolveFireworksInferenceApiKey(provider, {
        savedKey: getSavedProviderApiKey(params.config, provider),
      }),
    };
  }

  if (provider === "nvidia") {
    const model = getNvidiaPiModel(modelId);
    if (!model)
      throw new Error(`No PI model metadata available for provider nvidia (model: ${modelId}).`);
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: resolveNvidiaApiKey({
        savedKey: getSavedProviderApiKey(params.config, "nvidia"),
      }),
    };
  }

  if (provider === "lmstudio") {
    const prepared = await prepareLmStudioModelMetadataForInference({
      modelId,
      providerOptions: params.providerOptions ?? params.config.providerOptions,
      log: params.log,
    });
    const configuredApiKey =
      prepared.provider.apiKey ?? getSavedProviderApiKey(params.config, "lmstudio");
    return {
      model: buildLmStudioPiModel({
        metadata: prepared.metadata,
        baseUrl: prepared.provider.baseUrl,
      }),
      // pi-ai's OpenAI-compatible client refuses to initialize without a truthy apiKey,
      // even for local endpoints that do not require authentication.
      apiKey: configuredApiKey ?? LM_STUDIO_LOCAL_SENTINEL_API_KEY,
      ...(configuredApiKey
        ? {
            headers: {
              authorization: `Bearer ${configuredApiKey}`,
            },
          }
        : {}),
    };
  }

  if (isOpenCodeProviderName(provider)) {
    const model = getOpenCodePiModel(provider, modelId);
    if (!model)
      throw new Error(
        `No PI model metadata available for provider ${provider} (model: ${modelId}).`,
      );
    return {
      model: applySupportedModelMetadata(model, provider, modelId),
      apiKey: resolveOpenCodeApiKey(provider, {
        savedKey: getSavedProviderApiKey(params.config, provider),
      }),
    };
  }

  if (provider === "codex-cli") {
    throw new Error("codex-cli is handled by the Codex app-server runtime.");
  }

  if (provider === "antigravity") {
    throw new Error("Antigravity is handled by the Antigravity runtime.");
  }

  const exhaustive: never = provider;
  throw new Error(`Unsupported provider for PI runtime: ${String(exhaustive)}`);
}
