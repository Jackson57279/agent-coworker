# Liquid-DOM Desktop Components

Liquid-DOM is a desktop renderer layer for liquid-glass UI. Treat it like
shadcn/ui infrastructure: reusable React primitives that product UI can import
directly, not an A2UI catalog or agent protocol surface.

## Packages

- `@liquid-dom/react`: React 19 bindings. `LiquidCanvas` owns the canvas,
  Liquid-DOM scene, renderer, and frame loop.
- `@liquid-dom/core`: imperative scene graph and WebGPU renderer used by the
  React package.
- `@liquid-dom/layout`: renderer-agnostic layout engine used under the React
  components.

The desktop app depends on `@liquid-dom/react` from `apps/desktop/package.json`.

## Runtime

Liquid-DOM rendering requires `navigator.gpu`. DOM-backed `Html` content also
requires Chromium's experimental HTML-in-Canvas implementation, exposed through
the `CanvasDrawElement` feature. Cowork enables these in the Electron main
process before any `BrowserWindow` is created:

- `--enable-unsafe-webgpu`
- `--enable-features=CanvasDrawElement`

The web build and jsdom tests should degrade to normal React/Tailwind markup
because arbitrary browsers may not expose the required GPU path. Product UI
must gate Liquid-DOM surfaces on both the relevant desktop setting and runtime
support before mounting `LiquidCanvas`.

## Component System

Desktop Liquid-DOM primitives live under:

```text
apps/desktop/src/components/liquid-dom/
```

The package is organized like shadcn/ui: components are source-owned React
wrappers that product surfaces import directly. `LiquidGlassSurface` is the
shared rendering primitive; every higher-level component uses it so runtime
checks, WebGPU errors, reduced motion/transparency fallbacks, squircle shape
settings, and optical tuning stay consistent. It renders the Liquid-DOM glass
shape as a backdrop and keeps React children in normal DOM flow above the
canvas, preserving layout, focus, and accessibility for controls.

Available components:

- `LiquidGlassSurface`: base Liquid-DOM backdrop shell with tones and shapes.
- `LiquidGlassCard`: panel composition with header, title, description, action,
  content, and footer slots.
- `LiquidGlassButton`: capsule button shell with native button semantics.
- `LiquidGlassBadge`: compact metadata/status chip.
- `LiquidGlassToolbar`: fused control island with grouped children.
- `LiquidGlassTabs`: Radix tabs styled as a glass segmented control.
- `LiquidGlassField` and `LiquidGlassInput`: label, helper text, and input
  shell composition.
- `LiquidGlassDialog`: Radix dialog with a Liquid-DOM sheet body.
- `LiquidGlassBackdrop`: canvas-only backdrop for existing DOM content.

They preflight `navigator.gpu`, mount `LiquidCanvas` only when WebGPU is
available, and otherwise render token-backed fallback markup or nothing,
depending on whether the component owns visible content. Fallbacks are
intentional: standard DOM controls remain accessible and usable in jsdom, web
preview, non-WebGPU Chromium, and reduced-transparency/reduced-motion settings.

```tsx
import {
  LiquidGlassButton,
  LiquidGlassCard,
  LiquidGlassCardContent,
  LiquidGlassCardHeader,
  LiquidGlassCardTitle,
} from "@/components/liquid-dom";

export function ExamplePanel() {
  return (
    <LiquidGlassCard className="min-h-40" contentClassName="flex flex-col gap-3">
      <LiquidGlassCardHeader>
        <LiquidGlassCardTitle>Glass panel</LiquidGlassCardTitle>
      </LiquidGlassCardHeader>
      <LiquidGlassCardContent>
        Normal React content renders inside.
      </LiquidGlassCardContent>
      <LiquidGlassButton type="button">Continue</LiquidGlassButton>
    </LiquidGlassCard>
  );
}
```

The chat composer can use `LiquidGlassBackdrop`, but only when the desktop
Appearance setting is enabled and `navigator.gpu` is available in the renderer.
The full component gallery is available in Settings → Liquid Glass.

## How To Add More Components

1. Add new primitives under `apps/desktop/src/components/liquid-dom/`.
2. Export them from `apps/desktop/src/components/liquid-dom/index.ts`.
3. Compose `LiquidGlassSurface` unless a component is canvas-only.
4. Keep props idiomatic React, similar to shadcn wrappers: `className`,
   `contentClassName`, semantic sizing props, and normal `children`.
5. Use semantic Tailwind tokens for fallback markup so disabled WebGPU still
   looks native in Cowork.
6. Gate product usage on the relevant user setting and preflight
   `navigator.gpu` before mounting `LiquidCanvas`.
7. Use `frameloop="demand"` for mostly-static app UI.
8. Add focused jsdom tests for fallback/rendered structure, then verify the live
   Electron app with CDP for actual WebGPU pixels.

## Caveats

- `LiquidCanvas` creates its renderer in a layout effect. Keep a fallback path
  and an `onError` handler around every reusable primitive.
- DOM-backed `Html` content depends on Chromium canvas paint events. If the
  feature is unavailable, Liquid-DOM can initialize without correctly
  compositing live DOM content.
- Do not use Liquid-DOM for routine controls that shadcn already handles well.
  Use it where the glass renderer is the point: panels, overlays, inspectors,
  previews, and rich app surfaces.
