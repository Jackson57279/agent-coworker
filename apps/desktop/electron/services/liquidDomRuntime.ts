type ChromiumCommandLine = {
  appendSwitch: (switchName: string, value?: string) => void;
  getSwitchValue?: (switchName: string) => string;
  hasSwitch?: (switchName: string) => boolean;
};

export const LIQUID_DOM_CHROMIUM_FEATURES = ["CanvasDrawElement"] as const;

function mergeFeatureList(currentValue: string, requiredFeatures: readonly string[]): string {
  const features = new Set(
    currentValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  for (const feature of requiredFeatures) {
    features.add(feature);
  }
  return [...features].join(",");
}

/**
 * Liquid-DOM renders through WebGPU and uses Chromium's experimental
 * HTML-in-Canvas path for DOM-backed Html nodes. These switches must be added
 * before Electron creates any BrowserWindow.
 */
export function configureLiquidDomChromium(commandLine: ChromiumCommandLine): void {
  if (commandLine.hasSwitch?.("enable-unsafe-webgpu") !== true) {
    commandLine.appendSwitch("enable-unsafe-webgpu");
  }

  const existingFeatures = commandLine.getSwitchValue?.("enable-features") ?? "";
  const mergedFeatures = mergeFeatureList(existingFeatures, LIQUID_DOM_CHROMIUM_FEATURES);
  if (mergedFeatures) {
    commandLine.appendSwitch("enable-features", mergedFeatures);
  }
}
