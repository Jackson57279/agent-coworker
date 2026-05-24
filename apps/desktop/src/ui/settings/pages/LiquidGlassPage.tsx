import {
  BadgeCheckIcon,
  CommandIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "lucide-react";

import {
  LiquidGlassBadge,
  LiquidGlassButton,
  LiquidGlassCard,
  LiquidGlassCardAction,
  LiquidGlassCardContent,
  LiquidGlassCardDescription,
  LiquidGlassCardFooter,
  LiquidGlassCardHeader,
  LiquidGlassCardTitle,
  LiquidGlassDialog,
  LiquidGlassDialogContent,
  LiquidGlassDialogDescription,
  LiquidGlassDialogFooter,
  LiquidGlassDialogHeader,
  LiquidGlassDialogTitle,
  LiquidGlassDialogTrigger,
  LiquidGlassField,
  LiquidGlassFieldDescription,
  LiquidGlassFieldLabel,
  LiquidGlassInput,
  LiquidGlassSurface,
  LiquidGlassTabs,
  LiquidGlassTabsContent,
  LiquidGlassTabsList,
  LiquidGlassTabsTrigger,
  LiquidGlassToolbar,
  LiquidGlassToolbarGroup,
  useLiquidDomRuntimeState,
} from "../../../components/liquid-dom";
import { Button } from "../../../components/ui/button";

const componentRows = [
  ["Surface", "Shared Liquid-DOM renderer shell with graceful fallback."],
  ["Card", "Composed header, content, footer, and action slots."],
  ["Button", "Capsule control with tactile press feedback."],
  ["Badge", "Small status chip for navigation and metadata."],
  ["Toolbar", "Grouped controls in a fused glass island."],
  ["Tabs", "Radix tabs styled as a SwiftUI segmented glass control."],
  ["Field", "Label, description, and input shell composition."],
  ["Dialog", "Accessible Radix dialog with a Liquid-DOM sheet surface."],
] as const;

export function LiquidGlassPage() {
  const runtimeState = useLiquidDomRuntimeState();
  const runtimeLabel =
    runtimeState === "available"
      ? "WebGPU renderer available"
      : runtimeState === "checking"
        ? "Checking renderer"
        : "Fallback renderer active";

  return (
    <div className="flex flex-col gap-5" data-liquid-glass-gallery="true">
      <div className="relative overflow-hidden rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_20%_20%,rgba(125,211,252,0.22),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(135deg,var(--surface-sidebar-pane),var(--surface-window))] p-5">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <LiquidGlassCard tone="prominent" shape="sheet" contentClassName="gap-5 p-6">
            <LiquidGlassCardHeader>
              <LiquidGlassBadge variant="secondary" className="mb-2 w-fit">
                {runtimeLabel}
              </LiquidGlassBadge>
              <LiquidGlassCardTitle>Liquid Glass component system</LiquidGlassCardTitle>
              <LiquidGlassCardDescription>
                Source-owned primitives for desktop surfaces that need Apple-style refraction,
                squircle corners, grouped controls, and accessible fallbacks.
              </LiquidGlassCardDescription>
              <LiquidGlassCardAction>
                <LiquidGlassBadge variant="success">
                  <BadgeCheckIcon data-icon="inline-start" />
                  Ready
                </LiquidGlassBadge>
              </LiquidGlassCardAction>
            </LiquidGlassCardHeader>
            <LiquidGlassCardContent>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {componentRows.map(([name, detail]) => (
                  <div
                    key={name}
                    className="rounded-2xl border border-white/10 bg-background/18 p-3"
                  >
                    <div className="font-medium text-foreground">{name}</div>
                    <div className="mt-1 text-xs leading-relaxed">{detail}</div>
                  </div>
                ))}
              </div>
            </LiquidGlassCardContent>
            <LiquidGlassCardFooter>
              <LiquidGlassButton variant="primary">
                <CommandIcon data-icon="inline-start" />
                Primary action
              </LiquidGlassButton>
              <LiquidGlassButton variant="secondary">Secondary</LiquidGlassButton>
            </LiquidGlassCardFooter>
          </LiquidGlassCard>

          <LiquidGlassSurface
            tone="tinted"
            shape="sheet"
            contentClassName="flex h-full flex-col gap-4 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Navigation layer</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Glass components stay light and let content color show through.
                </div>
              </div>
              <LiquidGlassBadge variant="default">SwiftUI feel</LiquidGlassBadge>
            </div>
            <LiquidGlassToolbar>
              <LiquidGlassToolbarGroup>
                <LiquidGlassButton size="icon-sm" variant="ghost" aria-label="Search">
                  <SearchIcon />
                </LiquidGlassButton>
                <LiquidGlassButton size="icon-sm" variant="ghost" aria-label="Settings">
                  <Settings2Icon />
                </LiquidGlassButton>
                <LiquidGlassButton size="icon-sm" variant="ghost" aria-label="Tune">
                  <SlidersHorizontalIcon />
                </LiquidGlassButton>
              </LiquidGlassToolbarGroup>
            </LiquidGlassToolbar>
            <LiquidGlassField>
              <LiquidGlassFieldLabel htmlFor="liquid-glass-search">
                Search command
              </LiquidGlassFieldLabel>
              <LiquidGlassInput
                id="liquid-glass-search"
                placeholder="Ask Cowork to inspect a file"
              />
              <LiquidGlassFieldDescription>
                The field shell is Liquid-DOM; the input remains normal DOM.
              </LiquidGlassFieldDescription>
            </LiquidGlassField>
          </LiquidGlassSurface>
        </div>
      </div>

      <LiquidGlassTabs defaultValue="controls">
        <LiquidGlassTabsList aria-label="Liquid glass examples">
          <LiquidGlassTabsTrigger value="controls">Controls</LiquidGlassTabsTrigger>
          <LiquidGlassTabsTrigger value="surfaces">Surfaces</LiquidGlassTabsTrigger>
          <LiquidGlassTabsTrigger value="overlays">Overlays</LiquidGlassTabsTrigger>
        </LiquidGlassTabsList>
        <LiquidGlassTabsContent value="controls">
          <LiquidGlassCard tone="clear" contentClassName="gap-4 p-5">
            <LiquidGlassCardHeader>
              <LiquidGlassCardTitle>Controls</LiquidGlassCardTitle>
              <LiquidGlassCardDescription>
                Button, badge, toolbar, tabs, and field primitives compose like shadcn source.
              </LiquidGlassCardDescription>
            </LiquidGlassCardHeader>
            <LiquidGlassCardContent className="flex flex-wrap items-center gap-2">
              <LiquidGlassButton variant="primary">Continue</LiquidGlassButton>
              <LiquidGlassButton variant="default">Default</LiquidGlassButton>
              <LiquidGlassButton variant="destructive">Destructive</LiquidGlassButton>
              <LiquidGlassBadge variant="warning">Attention</LiquidGlassBadge>
            </LiquidGlassCardContent>
          </LiquidGlassCard>
        </LiquidGlassTabsContent>
        <LiquidGlassTabsContent value="surfaces">
          <div className="grid gap-4 md:grid-cols-3">
            <LiquidGlassSurface tone="clear" contentClassName="p-5">
              <div className="text-sm font-semibold">Clear</div>
              <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Lightweight material for quiet chrome.
              </div>
            </LiquidGlassSurface>
            <LiquidGlassSurface tone="regular" contentClassName="p-5">
              <div className="text-sm font-semibold">Regular</div>
              <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Default glass for cards and panels.
              </div>
            </LiquidGlassSurface>
            <LiquidGlassSurface tone="prominent" contentClassName="p-5">
              <div className="text-sm font-semibold">Prominent</div>
              <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Strong material for focused sheets.
              </div>
            </LiquidGlassSurface>
          </div>
        </LiquidGlassTabsContent>
        <LiquidGlassTabsContent value="overlays">
          <LiquidGlassCard tone="regular" contentClassName="gap-4 p-5">
            <LiquidGlassCardHeader>
              <LiquidGlassCardTitle>Dialog wrapper</LiquidGlassCardTitle>
              <LiquidGlassCardDescription>
                The overlay uses Radix semantics and portals while the sheet body uses Liquid-DOM.
              </LiquidGlassCardDescription>
            </LiquidGlassCardHeader>
            <LiquidGlassCardFooter>
              <LiquidGlassDialog>
                <LiquidGlassDialogTrigger asChild>
                  <LiquidGlassButton>Open glass dialog</LiquidGlassButton>
                </LiquidGlassDialogTrigger>
                <LiquidGlassDialogContent>
                  <LiquidGlassDialogHeader>
                    <LiquidGlassDialogTitle>Liquid-DOM dialog</LiquidGlassDialogTitle>
                    <LiquidGlassDialogDescription>
                      Accessible title, description, focus management, and glass rendering share one
                      component boundary.
                    </LiquidGlassDialogDescription>
                  </LiquidGlassDialogHeader>
                  <LiquidGlassDialogFooter>
                    <Button variant="outline" type="button">
                      Standard button
                    </Button>
                    <LiquidGlassButton variant="primary">Glass action</LiquidGlassButton>
                  </LiquidGlassDialogFooter>
                </LiquidGlassDialogContent>
              </LiquidGlassDialog>
            </LiquidGlassCardFooter>
          </LiquidGlassCard>
        </LiquidGlassTabsContent>
      </LiquidGlassTabs>
    </div>
  );
}
