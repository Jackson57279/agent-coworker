import { Stack } from "expo-router";
import { Platform } from "react-native";

import { useAppTheme } from "@/theme/use-app-theme";

export default function PairingLayout() {
  const theme = useAppTheme();
  const headerTransparent = Platform.OS !== "web";

  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBlurEffect: "none",
        headerLargeStyle: {
          backgroundColor: headerTransparent ? "transparent" : theme.background,
        },
        headerTintColor: theme.text,
        headerLargeTitleStyle: {
          color: theme.text,
          fontWeight: "700",
        },
        headerTitleStyle: {
          color: theme.text,
        },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Remote Access",
        }}
      />
      <Stack.Screen
        name="scan"
        options={{
          title: "Scan Desktop",
          headerLargeTitle: false,
          headerBackButtonDisplayMode: "minimal",
          presentation: "modal",
        }}
      />
    </Stack>
  );
}
