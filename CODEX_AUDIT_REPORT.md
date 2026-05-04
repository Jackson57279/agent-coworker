# Codex App-Server Integration: Comprehensive Audit Report

> Audit conducted 2026-05-04 across runtime, protocol, resolver, auth, UI/UX, prompts/tools, tests, observability, and model registry.

---

## Executive Summary

The Codex app-server integration works for the happy path but has **critical reliability gaps**, **significant UX holes**, and **architectural mismatches** between Cowork's tool-centric system and Codex's native capabilities. The most severe issues are:

1. **Abort/cancellation is broken** — stopping a turn only affects the UI; the app-server keeps running for up to 30 minutes.
2. **No timeouts on startup RPCs** — a hung `initialize`, `model/list`, or `thread/start` waits forever.
3. **System prompt contradicts itself** — the model is taught to use Cowork tools for 700+ lines, then told at the very end not to.
4. **File changes are invisible** — Codex's core `fileChange` items are not mapped to stream parts.
5. **Image support is falsely advertised** — `supportsImageInput: true` in the registry, but the runtime drops all image attachments.
6. **Logout is a UX lie** — disconnecting in Cowork does not clear Codex's own auth tokens.
7. **Downloaded binaries have no integrity verification** — no checksums, no signatures, no retry logic.

---

## 1. CRITICAL — Reliability & Runtime

### 1.1 `abortSignal` is completely ignored after the initial check
- **File:** `src/runtime/codexAppServerRuntime.ts:504`
- **Issue:** `abortSignal` is polled once at the start of `runTurn`, then never again. It is not passed to `client.request()`, not checked during `waitForTurnCompletion`, and does not kill the child process.
- **Impact:** User hits "Stop" → UI shows cancelled → app-server continues making OpenAI API calls and possibly modifying files for up to 30 minutes.
- **Fix:** Register an abort listener that calls `client.close()` (sending SIGTERM/SIGKILL) and rejects the turn promise immediately.

### 1.2 No timeouts on any startup RPC call
- **File:** `src/runtime/codexAppServerRuntime.ts:152-176`, `505`, `520-541`, `566`
- **Issue:** `model/list`, `initialize`, `thread/start`, `thread/resume`, and `turn/start` have **no request-level timeouts**. Only `waitForTurnCompletion` has a 30-minute timeout.
- **Impact:** If any of these hang (e.g., app-server binary is corrupt, network to OpenAI is down), the turn never starts and never fails. The user sees an infinite spinner.
- **Fix:** Add a 30-60s timeout to every `client.request()` call, or wrap them in `Promise.race` with a timeout.

### 1.3 `thread/resume` failure has no fallback to `thread/start`
- **File:** `src/runtime/codexAppServerRuntime.ts:520-541`
- **Issue:** If `thread/resume` fails (e.g., app-server restarted and lost thread state), the code throws. It does not catch the error and fall back to `thread/start`.
- **Impact:** A model switch or app-server restart breaks all existing Codex conversations permanently for that session.
- **Fix:** Wrap `thread/resume` in try/catch and fall back to `thread/start` on failure.

### 1.4 `withCodexAppServerClient` `finally` suppresses original errors
- **File:** `src/providers/codexAppServerClient.ts:243-245`
- **Issue:** If `fn` throws and `client.close()` also throws, the original error is lost.
- **Fix:** Capture the original error and re-throw it if `close()` throws.

### 1.5 SIGTERM timeout is only 500ms before SIGKILL
- **File:** `src/providers/codexAppServerClient.ts:222-224`
- **Issue:** A process with open file handles or network connections may need more time to shut down cleanly. 500ms is dangerously short.
- **Fix:** Increase to 5-10 seconds, or make it configurable.

### 1.6 `respondToServerRequest` can throw uncaught `EPIPE`
- **File:** `src/providers/codexAppServerClient.ts:205,215`
- **Issue:** `child.stdin.write()` is not wrapped in try/catch. If the process has died, the uncaught exception becomes an unhandled rejection.
- **Fix:** Wrap `stdin.write` in try/catch and return a JSON-RPC error response.

---

## 2. HIGH — Prompt & Tool Integration

### 2.1 System prompt teaches Cowork tools, then contradicts itself at the end
- **File:** `src/runtime/codexAppServerRuntime.ts:118-129`, `src/prompt.ts` (base templates)
- **Issue:** The base system prompt (`gpt-5.2.md`) spends ~700 lines teaching the model to use `bash`, `read`, `write`, `skill`, `memory`, `spawnAgent`, etc. The "Codex App-Server Tool Boundary" note is appended at the very end. For long contexts, trailing instructions have weaker attention.
- **Impact:** The model hallucinates calls to suppressed Cowork tools (e.g., tries to call `bash` when it should use Codex's native `commandExecution`).
- **Fix:** Strip or conditionally render tool-specific sections when `provider === "codex-cli"`. Move the boundary note to the top of the prompt, or better, use a codex-specific prompt template.

### 2.2 `providerOwnsExecutableTools` suppresses ALL tools, not just executable ones
- **File:** `src/server/agents/DelegateRunner.ts:42-44`, `src/agent.ts:332-336`
- **Issue:** The function is named `providerOwnsExecutableTools`, but it empties the entire tool map — including `read`, `webSearch`, `webFetch`, `ask`, `todoWrite`, `notebookEdit`, `skill`, `memory`, `usage`, and all agent control tools.
- **Impact:** Codex cannot use ANY Cowork tools, even read-only ones. The `usesLegacyCodexWebSearch` logic in `src/tools/index.ts` is dead code because `createTools` is skipped entirely.
- **Fix:** Rename to `providerOwnsTools` or selectively suppress only executable/tools that conflict with Codex's native capabilities.

### 2.3 `fileChange` items are completely invisible
- **File:** `src/runtime/codexAppServerRuntime.ts:339-416`
- **Issue:** `handleNotification` maps `agentMessage`, `reasoning`, `commandExecution`, and `mcpToolCall` — but has zero cases for `fileChange`. Codex's core file-editing capability produces no visible stream parts.
- **Impact:** The UI shows no file edits as they happen. Users cannot see what Codex is changing until the turn completes (if at all).
- **Fix:** Add `fileChange` mapping to `tool-call`/`tool-result` or `file` stream parts.

### 2.4 `item/toolRequestUserInput` is unhandled
- **File:** `src/runtime/codexAppServerRuntime.ts:304-318`
- **Issue:** `handleServerRequest` returns `{}` for any unhandled method. If Codex asks the user a clarifying question via `item/toolRequestUserInput`, the runtime replies with an empty object.
- **Impact:** Likely breaks the turn or causes Codex to behave unexpectedly.
- **Fix:** Implement proper handling for `toolRequestUserInput` by forwarding to the user's `askUser` callback.

### 2.5 `supportsImageInput: true` but runtime drops all image parts
- **File:** `config/models/codex-cli/gpt-5.4.json`, `src/runtime/codexAppServerRuntime.ts:60-85`, `556-568`
- **Issue:** `gpt-5.4.json` claims image support, but `extractTextContent` ignores image parts, and `turn/start` only sends `[{ type: "text", text: userText, text_elements: [] }]`. If a user sends only an image with no text, the runtime throws `"codex app-server runtime requires a user message."`
- **Impact:** Violates AGENTS.md rule: "`supportsImageInput` must match both prompt instructions and runtime/tool payload handling."
- **Fix:** Either set `supportsImageInput: false` for all Codex models until the runtime supports images, or implement image part forwarding.

### 2.6 Plugin bundles, skills, memory, A2UI are described but not wired
- **File:** `src/prompt.ts:734-739`, `src/agent.ts:332-336`
- **Issue:** The prompt contains "Enabled Plugin Bundles", "Available Skills", "Memory" sections, and A2UI instructions — but all corresponding tools are suppressed for Codex.
- **Impact:** Pure prompt noise (~50-100 lines of wasted tokens). Model may hallucinate tool calls.
- **Fix:** Strip these sections from the prompt when `provider === "codex-cli"`.

---

## 3. HIGH — Auth & Account Management

### 3.1 Logout does not clear app-server credentials (UX lie)
- **File:** `src/connect.ts:242-254`
- **Issue:** `disconnectProvider` for Codex deletes the Cowork connection store entry but does not touch `~/.codex/auth.json` or call any app-server logout RPC. The user clicks "Log out", sees success, but remains fully authenticated.
- **Impact:** Reconnecting silently re-authenticates. Users cannot actually revoke access.
- **Fix:** Call `account/logout` or `auth/revoke` on the app-server if available, or document that logout is Cowork-local only.

### 3.2 Browser open failure is silently ignored
- **File:** `src/providers/codexAppServerAuth.ts:446`
- **Issue:** `openExternalUrl(authUrl)` returns a boolean indicating success/failure, but `loginCodexAppServerChatGpt` ignores it. If the browser fails to open, the user gets zero feedback and `waitForLogin` hangs for 10 minutes.
- **Fix:** Check the return value and throw an actionable error if the browser could not be opened.

### 3.3 `waitForLogin` hangs on client crash — no close/error handler
- **File:** `src/providers/codexAppServerAuth.ts:476-498`
- **Issue:** The notification listener only listens for `account/login/completed`. If the app-server process crashes or the pipe breaks, the promise hangs until the 10-minute timeout.
- **Fix:** Also listen for client close/error events and reject early.

### 3.4 No API key auth method for Codex
- **File:** `src/shared/providerAuthMethods.ts:115-117`
- **Issue:** Codex only has `oauth_cli` (ChatGPT browser sign-in). The app-server protocol supports `type: "apiKey"` accounts, but Cowork has no registry entry for it.
- **Impact:** Users who want to use an OpenAI API key directly cannot do so through the normal auth flow.
- **Fix:** Add `{ id: "api_key", type: "api", label: "API key" }` to the Codex auth methods.

### 3.5 `tokenRecoverable` is defined but never set for Codex
- **File:** `src/providerStatus.ts:85-86`, `304-386`
- **Issue:** The `tokenRecoverable` field is meant to indicate that a refresh token exists and recovery is possible. `getCodexCliStatus` never sets it.
- **Impact:** Desktop restarts may show "Not connected" even when a refresh could have worked.
- **Fix:** Set `tokenRecoverable: true` when `accountResult.requiresOpenaiAuth` is true and an account exists.

---

## 4. HIGH — Installation & Binary Management

### 4.1 No checksum or signature verification on downloaded binaries
- **File:** `src/providers/codexAppServerResolver.ts:328-339`
- **Issue:** `downloadFile` fetches the asset and writes it directly. There is zero SHA256, SHA512, or signature verification.
- **Impact:** A corrupted download (network truncation, CDN error, MITM) results in executing an untrusted/corrupted binary.
- **Fix:** Verify against release checksums if available, or at minimum check file size.

### 4.2 Custom version comparator breaks semver pre-release/build metadata
- **File:** `src/providers/codexAppServerResolver.ts:143-153`
- **Issue:** `compareVersions` splits on `/[.-]/` and `parseInt`s each part. `1.0.0-beta` becomes `[1,0,0,0]` (beta → NaN → 0). Pre-release versions compare incorrectly.
- **Impact:** May report no update available when a pre-release should be updated, or vice versa.
- **Fix:** Use a proper semver library or `semver` comparison.

### 4.3 Linux hardcoded to musl — no glibc detection
- **File:** `src/providers/codexAppServerResolver.ts:89-92`
- **Issue:** Linux targets are hardcoded to `*-unknown-linux-musl`. On standard glibc distros (Ubuntu, Debian, Fedora), musl binaries may fail.
- **Fix:** Detect libc flavor at runtime (`ldd --version`, `process.report.getReport()`) and select the appropriate target triple.

### 4.4 Update button can silently shadow a system install
- **File:** `src/providers/codexAppServerResolver.ts:498-515`, `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx:983-990`
- **Issue:** If the user has a system install and clicks "Update", the code downloads and installs a managed copy, shadowing the system one. The UI gives no warning.
- **Fix:** Disable "Update" for system installs, or show a confirmation dialog explaining the transition.

### 4.5 No retry, no timeout, no resume on network failures
- **File:** `src/providers/codexAppServerResolver.ts:284-340`
- **Issue:** `fetchCodexRelease` and `downloadFile` have zero retry logic, no fetch timeout, and no partial download resume (`Range` header).
- **Impact:** GitHub rate-limiting (60 req/hr per IP) or flaky connections cause immediate, opaque failures.
- **Fix:** Add exponential backoff retry, explicit fetch timeout, and `GITHUB_TOKEN` support for authenticated API requests.

### 4.6 Cross-process race conditions with no file locking
- **File:** `src/providers/codexAppServerResolver.ts:66`, `385-435`
- **Issue:** `inFlightInstalls` is a module-level singleton — only deduplicates within one Node.js process. Two Cowork instances can download to the same path concurrently. `promoteManagedInstall` uses `fs.copyFile` which is non-atomic.
- **Impact:** Corrupt binary from interleaved writes.
- **Fix:** Use atomic rename (`fs.rename`) or a file lock (e.g., `proper-lockfile`).

---

## 5. MEDIUM — Desktop UI/UX

### 5.1 "Update" button is misleading when app-server is not installed
- **File:** `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx:983-990`
- **Issue:** When `source === "missing"`, the button still says "Update". It should say "Install".
- **Fix:** Conditional button label based on install status.

### 5.2 No download/install progress indicator
- **File:** `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx:983-990`
- **Issue:** The button disables and shows "Updating..." but there is no progress bar, bytes, or ETA. For a 50MB download on a slow connection, the UI appears frozen.
- **Fix:** Pipe download progress from the server to the client via JSON-RPC notifications, or at least show an indeterminate progress bar.

### 5.3 No cancel or timeout for OAuth flow
- **File:** `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx:496-534`, `DesktopOnboarding.tsx`
- **Issue:** The auth flow opens a browser and leaves the UI static. No loading state, no timeout message, no "Cancel" or "Retry" action.
- **Fix:** Add a loading spinner on the Sign in button, a cancel action, and a timeout message.

### 5.4 No logout/disconnect button for Codex
- **File:** `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx:578`
- **Issue:** Once connected, auth methods are hidden entirely. There is no way for the user to intentionally disconnect.
- **Fix:** Show a "Disconnect" button when Codex is authenticated.

### 5.5 Onboarding does not explain the app-server requirement
- **File:** `apps/desktop/src/ui/onboarding/DesktopOnboarding.tsx`
- **Issue:** A user can sign in to Codex during onboarding without understanding that a local binary is also needed. The app-server auto-installs on first use, but this is silent and may be blocked in corporate environments.
- **Fix:** Add explanatory text to the Codex onboarding card: "Codex requires a local app-server binary. Cowork will download it automatically on first use (~50MB)."

### 5.6 Missing sandbox/approval policy settings
- **File:** `apps/desktop/src/ui/settings/pages/WorkspacesPage.tsx`
- **Issue:** Codex runs shell commands, but there is no per-workspace UI to control its sandbox mode separate from the global `yolo` toggle.
- **Fix:** Add per-provider sandbox and approval policy controls.

### 5.7 Missing accessibility attributes
- **File:** `apps/desktop/src/ui/settings/pages/ProvidersPage.tsx`
- **Issue:** OAuth button has no `aria-label`. App-server Check/Update buttons have no `aria-label`. Status changes are not announced via `aria-live`.
- **Fix:** Add proper ARIA labels and live regions for async operations.

---

## 6. MEDIUM — Error Handling & Observability

### 6.1 JSON-RPC `error.code` and `error.data` are discarded
- **File:** `src/providers/codexAppServerClient.ts:136-137`
- **Issue:** Only `error.message` is preserved. Structured error codes (rate limits, auth failures, debug data) are lost.
- **Fix:** Include `code` and `data` in the thrown Error object (e.g., as properties).

### 6.2 Diagnostics wrapper lacks essential context
- **File:** `src/runtime/codexAppServerRuntime.ts:131-150`
- **Issue:** `withCodexAppServerDiagnostics` includes the binary path but not the model, thread ID, turn ID, or working directory.
- **Fix:** Add these fields to the diagnostic string.

### 6.3 stderr is treated as plain log lines, not classified
- **File:** `src/providers/codexAppServerClient.ts:107-110`
- **Issue:** stderr from the app-server is logged verbatim. No severity extraction, no deduplication, no surfacing of critical failures (panics, segfaults) as UI errors.
- **Fix:** Scan stderr for keywords like `panic`, `segmentation fault`, `error:` and surface them as error stream parts.

### 6.4 App-server crash during notification stream is silent
- **File:** `src/providers/codexAppServerClient.ts:99-105`
- **Issue:** If the process exits while `pending.size === 0` (e.g., during a long notification stream), no error is thrown. The turn hangs for 30 minutes.
- **Fix:** Track an "expected open" flag and reject if the process exits unexpectedly before `turn/completed`.

### 6.5 No codex-specific telemetry
- **Files:** `src/server/session/TurnExecutionManager.ts`, `src/providers/codexAppServerResolver.ts`
- **Issue:** No metrics for app-server startup time, version per turn, install success/failure, JSON-RPC error code distribution, approval latency, or steer events.
- **Fix:** Emit structured telemetry events for app-server lifecycle, version, and key RPC latencies.

### 6.6 Provider status check spawns a full process every time
- **File:** `src/providerStatus.ts:304-386`
- **Issue:** `getCodexCliStatus` calls `readCodexAppServerAccount`, which starts a brand new app-server process, initializes it, makes `account/read`, then tears it down. There is no persistent heartbeat.
- **Impact:** Slow and expensive status checks. If the binary is corrupt, every check is slow.
- **Fix:** Cache the status for a short TTL, or use a lightweight health check that doesn't require a full spawn.

---

## 7. MEDIUM — Testing Gaps

### 7.1 Mock app-server is too cooperative
- **File:** `test/runtime.codex-app-server.test.ts:37-93`
- **Issue:** The mock never returns malformed JSON, exits unexpectedly, sends out-of-order notifications, or hangs. It masks real integration risks.
- **Fix:** Add "chaos" tests that simulate crash, malformed JSON, timeout, and out-of-order notifications.

### 7.2 No tests for error paths
- **Missing:**
  - App-server crash mid-turn
  - Malformed JSON-RPC on stdout
  - Request/startup hangs
  - Abort signal propagation
  - `thread/resume` failure fallback
  - `turn/completed` with `status: "failed"`
  - `item/commandExecution/*` and `item/mcpToolCall` notification mapping
  - `item/fileChange/requestApproval`
  - Image/file attachment forwarding
- **Fix:** Add tests for each of these.

### 7.3 Resolver tests only cover Windows
- **File:** `test/providers/codex-app-server-resolver.test.ts:119-145`
- **Issue:** The managed download test hardcodes `platform: "win32"`. The `tar.gz` extraction path (macOS/Linux) is **never tested**.
- **Fix:** Add platform-matrix tests for Darwin and Linux.

### 7.4 No direct tests for auth functions
- **Missing:** `test/providers/codex-app-server-auth.test.ts` does not exist.
- **Untested:** `readCodexAppServerAccount`, `readCodexAppServerRateLimits`, `loginCodexAppServerChatGpt`, `listCodexAppServerApps`, `listCodexAppServerModels`, pagination logic.
- **Fix:** Create a dedicated test file.

### 7.5 No full-stack integration test
- **Missing:** No test exercises the path: WebSocket → JSON-RPC route → server → runtime → app-server.
- **Fix:** Add an E2E test that starts the server and drives a Codex turn end-to-end.

---

## 8. LOW — Code Quality & Polish

### 8.1 `experimentalRawEvents` missing on `thread/resume`
- **File:** `src/runtime/codexAppServerRuntime.ts:522-531`
- **Issue:** `thread/start` passes `experimentalRawEvents`, but `thread/resume` does not. Resumed threads produce fewer raw events.
- **Fix:** Add `experimentalRawEvents` to the resume branch.

### 8.2 `textVerbosity` is ignored by the Codex runtime
- **File:** `src/runtime/codexAppServerRuntime.ts:573-576`, `src/shared/openaiCompatibleOptions.ts:59`
- **Issue:** `textVerbosity` exists in provider options and UI settings, but the runtime never reads it.
- **Fix:** Pass it to `turn/start` if the app-server supports it, or remove it from Codex options.

### 8.3 Advanced `webSearch` options are discarded
- **File:** `src/runtime/codexAppServerRuntime.ts:111-116`
- **Issue:** `contextSize`, `allowedDomains`, and `location` are never forwarded to the app-server.
- **Fix:** Forward them in `codexThreadConfig` if the app-server supports them.

### 8.4 `COWORK_CODEX_APP_SERVER_ARGS` splits on whitespace, breaking quoted arguments
- **File:** `src/providers/codexAppServerResolver.ts:247`
- **Issue:** `rawArgs.split(/\s+/)` breaks arguments containing spaces or quotes.
- **Fix:** Use a shell-quote parser or accept JSON array syntax.

### 8.5 `clientMessageId` not forwarded to `turn/start`
- **File:** `src/runtime/codexAppServerRuntime.ts:566`
- **Issue:** The JSON-RPC schema shows `turn/start` accepts `clientMessageId`, but the runtime does not pass it.
- **Fix:** Forward `clientMessageId` from `params`.

### 8.6 Old versions accumulate with no pruning
- **File:** `src/providers/codexAppServerResolver.ts`
- **Issue:** Every version is stored under `~/.cowork/codex-app-server/versions/<version>/`. No cleanup policy.
- **Fix:** Keep only the last N versions (e.g., 3).

### 8.7 `AGENTS.md` Codex auth path rule is not enforced by code
- **File:** `AGENTS.md`
- **Issue:** The rule says auth lives at `~/.cowork/auth/codex-cli/auth.json`, but the code delegates all token storage to the Codex CLI subprocess (likely `~/.codex`).
- **Fix:** Update `AGENTS.md` or implement the stated rule.

---

## 9. MISSING FEATURES — Architectural Gaps

| Feature | Why It Matters | Current State |
|---------|---------------|---------------|
| **App-server logs viewer** | Debugging auth/startup failures is impossible | Not available |
| **App-server restart/kill action** | If the app-server hangs, user has no recourse | Not available |
| **Rate limit display in chat UI** | Users hit limits mid-thread with no warning | Only in settings |
| **Thread history / reasoning viewer** | Codex emits reasoning that's not shown persistently | Ephemeral only |
| **Plugin manager for Codex** | `OpenAiNativeConnectorsPage` exists but is buried | Not linked from provider card |
| **Offline mode / cached binary** | If GitHub is unreachable, first use fails | No fallback |
| **Custom registry/mirror support** | Corporate environments need Artifactory/Nexus mirrors | Hardcoded to GitHub |
| **macOS Gatekeeper quarantine handling** | Downloaded binaries may be blocked on first run | Not handled |
| **Multiple Codex accounts** | Users may have personal + work ChatGPT accounts | Not supported |
| **API key auth for Codex** | Some users prefer API keys over ChatGPT OAuth | Protocol supports it; UI omits it |

---

## Recommended Priority Order

### P0 — Fix immediately (ship-blocking)
1. Add `abortSignal` listener that kills the child process (`codexAppServerRuntime.ts`)
2. Add timeouts to all `client.request()` calls (`codexAppServerRuntime.ts`)
3. Map `fileChange` items to stream parts (`codexAppServerRuntime.ts`)
4. Fix `providerOwnsExecutableTools` to not suppress read-only tools, or strip tool instructions from prompt (`DelegateRunner.ts`, `prompt.ts`)
5. Add integrity verification or at minimum file-size check to downloads (`codexAppServerResolver.ts`)

### P1 — Fix before next release
6. Add fallback from `thread/resume` to `thread/start` on failure
7. Fix browser open failure handling and `waitForLogin` crash detection (`codexAppServerAuth.ts`)
8. Add "Install" vs "Update" button labels and download progress (`ProvidersPage.tsx`)
9. Fix `supportsImageInput` mismatch (either support images or set to `false`)
10. Add proper logout that clears app-server tokens (`connect.ts`)
11. Add `item/toolRequestUserInput` handling
12. Add `error.code` preservation to JSON-RPC client (`codexAppServerClient.ts`)

### P2 — Improve quality of life
13. Add codex-specific telemetry (startup time, version, error codes)
14. Add stderr severity classification (panic → error bubble)
15. Fix semver comparison in resolver
16. Add Linux glibc detection
17. Add cross-process file locking for installs
18. Strip plugin/skill/memory/A2UI sections from Codex prompts
19. Add `textVerbosity` forwarding
20. Prune old app-server versions
21. Add cancel/retry to OAuth UI
22. Add sandbox mode toggle per-workspace
23. Fill test gaps (chaos tests, platform matrix, auth tests, E2E)
