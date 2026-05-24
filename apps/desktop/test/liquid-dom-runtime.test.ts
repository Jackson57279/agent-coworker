import { describe, expect, test } from "bun:test";

import { configureLiquidDomChromium } from "../electron/services/liquidDomRuntime";

function createCommandLineStub(existing: Record<string, string | true> = {}) {
  const switches = new Map<string, string | true>(Object.entries(existing));
  const calls: Array<{ name: string; value?: string }> = [];
  return {
    calls,
    commandLine: {
      appendSwitch(name: string, value?: string) {
        calls.push(value === undefined ? { name } : { name, value });
        switches.set(name, value ?? true);
      },
      getSwitchValue(name: string) {
        const value = switches.get(name);
        return typeof value === "string" ? value : "";
      },
      hasSwitch(name: string) {
        return switches.has(name);
      },
    },
  };
}

describe("configureLiquidDomChromium", () => {
  test("enables WebGPU and CanvasDrawElement before windows are created", () => {
    const { commandLine, calls } = createCommandLineStub();

    configureLiquidDomChromium(commandLine);

    expect(calls).toEqual([
      { name: "enable-unsafe-webgpu" },
      { name: "enable-features", value: "CanvasDrawElement" },
    ]);
  });

  test("preserves existing Chromium feature flags", () => {
    const { commandLine, calls } = createCommandLineStub({
      "enable-unsafe-webgpu": true,
      "enable-features": "ExistingFeature",
    });

    configureLiquidDomChromium(commandLine);

    expect(calls).toEqual([
      { name: "enable-features", value: "ExistingFeature,CanvasDrawElement" },
    ]);
  });
});
