import { Stack } from "expo-router";
import { Platform } from "react-native";

import { useAppTheme } from "@/theme/use-app-theme";

export default function SkillsTabLayout() {
  const theme = useAppTheme();
  const headerTransparent = Platform.OS !== "web";

  return (
    <Stack
      screenOptions={{
        headerTransparent,
        headerShadowVisible: false,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerBlurEffect: "none",
        headerTintColor: theme.text,
        headerLargeStyle: {
          backgroundColor: headerTransparent ? "transparent" : theme.background,
        },
        headerTitleStyle: {
          color: theme.text,
          fontWeight: "700",
        },
        headerLargeTitleStyle: {
          color: theme.text,
          fontWeight: "800",
        },
        contentStyle: {
          backgroundColor: theme.background,
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Skills" }} />
    </Stack>
  );
}
