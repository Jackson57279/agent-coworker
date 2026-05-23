import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { forwardRef, type ComponentRef } from "react";
import { Platform, Pressable, type PressableProps } from "react-native";
import { useAppTheme } from "@/theme/use-app-theme";
import { SFSymbol } from "./sf-symbol";

type HeaderGlassButtonProps = Omit<PressableProps, "children" | "style"> & {
  icon: string;
};

export const HeaderGlassButton = forwardRef<ComponentRef<typeof Pressable>, HeaderGlassButtonProps>(
  function HeaderGlassButton(
    {
      icon,
      accessibilityLabel,
      accessibilityRole = "button",
      hitSlop = 8,
      disabled,
      ...pressableProps
    },
    ref,
  ) {
    const theme = useAppTheme();
    const shouldUseGlass = Platform.OS === "ios" && isLiquidGlassAvailable();

    return (
      <Pressable
        ref={ref}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        disabled={disabled}
        hitSlop={hitSlop}
        {...pressableProps}
        style={({ pressed }) => ({
          position: "relative",
          width: 34,
          height: 34,
          overflow: "hidden",
          borderRadius: 17,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: shouldUseGlass ? "transparent" : theme.surfaceMuted,
          opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
        })}
      >
        {shouldUseGlass ? (
          <GlassView
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: 17,
              borderCurve: "continuous",
            }}
          />
        ) : null}
        <SFSymbol name={icon} size={18} color={theme.text} />
      </Pressable>
    );
  },
);
