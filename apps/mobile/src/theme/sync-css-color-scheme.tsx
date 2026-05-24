import { colorScheme as cssColorScheme } from "react-native-css";
import { useColorScheme } from "react-native";

import { resolveColorScheme } from "./resolve-color-scheme";

export function SyncCssColorScheme() {
  const scheme = resolveColorScheme(useColorScheme());
  cssColorScheme.set(scheme);
  return null;
}
