import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const headerSource = readFileSync(
  new URL("../apps/mobile/src/components/ui/header-glass-button.tsx", import.meta.url),
  "utf8",
);

const workspaceSource = readFileSync(
  new URL("../apps/mobile/src/app/(app)/(tabs)/workspace/index.tsx", import.meta.url),
  "utf8",
);

describe("mobile header glass button", () => {
  test("keeps the Pressable as the only interactive header control", () => {
    expect(headerSource).not.toContain("<GlassView isInteractive");
    expect(headerSource).toContain('pointerEvents="none"');

    const pressableIndex = headerSource.indexOf("<Pressable");
    const glassIndex = headerSource.indexOf("<GlassView");

    expect(pressableIndex).toBeGreaterThanOrEqual(0);
    expect(glassIndex).toBeGreaterThan(pressableIndex);
  });

  test("uses Expo Router menu triggers without wrapping the header button in asChild", () => {
    expect(workspaceSource).toContain("<Link.Trigger>");
    expect(workspaceSource).not.toContain('href="/(app)/(tabs)/workspace" asChild');
  });
});
