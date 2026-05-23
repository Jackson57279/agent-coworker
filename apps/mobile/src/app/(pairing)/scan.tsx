import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";

import { Screen } from "@/components/ui/screen";
import { SectionCard } from "@/components/ui/section-card";
import { SFSymbol } from "@/components/ui/sf-symbol";
import { StatusPill } from "@/components/ui/status-pill";
import { usePairingStore } from "@/features/pairing/pairingStore";
import { validatePairingPayload } from "@/features/pairing/qrValidation";
import { createPairingScanHandler } from "@/features/pairing/scanHandler";
import { useAppTheme } from "@/theme/use-app-theme";

export default function PairingScanScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedPayload, setScannedPayload] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState("");
  const connectionState = usePairingStore((state) => state.connectionState);
  const connectWithQr = usePairingStore((state) => state.connectWithQr);
  const scanHandlerRef = useRef<ReturnType<typeof createPairingScanHandler> | null>(null);

  const granted = permission?.granted ?? false;
  const pairingInFlight =
    scannedPayload !== null &&
    (connectionState.status === "pairing" || connectionState.status === "connecting");

  if (!scanHandlerRef.current) {
    scanHandlerRef.current = createPairingScanHandler({
      validatePairingPayload,
      connectWithQr,
      setScannedPayload,
      onSuccess: () => {
        router.replace("/(app)/(tabs)/threads");
      },
      onInvalidPayload: (message) => {
        Alert.alert("Invalid QR", message);
      },
      onPairingError: (message) => {
        Alert.alert("Pairing failed", message);
      },
    });
  }

  async function onBarcodeScanned(result: BarcodeScanningResult) {
    await scanHandlerRef.current?.handleScan(result);
  }

  async function pairManualPayload() {
    const payload = manualPayload.trim();
    if (!payload || pairingInFlight) {
      return;
    }
    await scanHandlerRef.current?.handleScan({ data: payload });
  }

  return (
    <Screen scroll>
      <Animated.View entering={FadeIn.duration(400)}>
        <SectionCard
          title="Scan your computer"
          description="Point your camera at the QR code shown in Cowork Desktop's remote access screen."
          action={
            <StatusPill
              label={granted ? "Camera ready" : "Permission needed"}
              tone={granted ? "success" : "warning"}
            />
          }
        >
          {!granted ? (
            <View style={{ gap: 16, alignItems: "center", paddingVertical: 20 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  borderCurve: "continuous",
                  backgroundColor: theme.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SFSymbol name="camera.fill" size={40} color={theme.primary} />
              </View>
              <View style={{ gap: 8, alignItems: "center" }}>
                <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
                  Camera access required
                </Text>
                <Text
                  selectable
                  style={{
                    color: theme.textSecondary,
                    fontSize: 14,
                    lineHeight: 20,
                    textAlign: "center",
                  }}
                >
                  Cowork Mobile needs camera access to scan the pairing code from your desktop.
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  void requestPermission();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 14,
                  borderCurve: "continuous",
                  backgroundColor: pressed ? theme.accent : theme.primary,
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  marginTop: 8,
                })}
              >
                <SFSymbol name="camera.fill" size={18} color={theme.primaryText} />
                <Text style={{ color: theme.primaryText, fontWeight: "700", fontSize: 16 }}>
                  Grant camera access
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={{
                overflow: "hidden",
                borderRadius: 24,
                borderCurve: "continuous",
                borderWidth: 2,
                borderColor: theme.border,
                backgroundColor: theme.backgroundMuted,
              }}
            >
              <CameraView
                style={{ height: 400, width: "100%" }}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
                onBarcodeScanned={pairingInFlight ? undefined : onBarcodeScanned}
              />
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  justifyContent: "center",
                  alignItems: "center",
                  pointerEvents: "none",
                }}
              >
                <View
                  style={{
                    width: 200,
                    height: 200,
                    borderRadius: 24,
                    borderCurve: "continuous",
                    borderWidth: 2,
                    borderColor: "rgba(255, 255, 255, 0.5)",
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  }}
                />
              </View>
            </View>
          )}
        </SectionCard>
      </Animated.View>

      {pairingInFlight && (
        <Animated.View entering={FadeInUp.delay(200).duration(400)}>
          <SectionCard
            title="Connecting..."
            description="Establishing secure session with your computer"
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  backgroundColor: theme.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SFSymbol name="lock.shield.fill" size={22} color={theme.primary} />
              </View>
              <Text selectable style={{ color: theme.textSecondary, fontSize: 15, flex: 1 }}>
                Connecting directly to your desktop...
              </Text>
            </View>
          </SectionCard>
        </Animated.View>
      )}

      {__DEV__ ? (
        <Animated.View entering={FadeInUp.delay(400).duration(400)}>
          <SectionCard
            title="Debug pairing"
            description="Paste a QR payload when the simulator cannot use the camera."
          >
            <View style={{ gap: 10 }}>
              <TextInput
                value={manualPayload}
                onChangeText={setManualPayload}
                placeholder="Paste cowork-pair:// payload"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                style={{
                  minHeight: 82,
                  borderRadius: 16,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surfaceMuted,
                  color: theme.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 12,
                  lineHeight: 18,
                  fontVariant: ["tabular-nums"],
                  fontFamily: theme.fontFamilyMono,
                }}
              />
              <Pressable
                disabled={!manualPayload.trim() || pairingInFlight}
                onPress={() => {
                  void pairManualPayload();
                }}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 14,
                  borderCurve: "continuous",
                  backgroundColor: pressed ? theme.accent : theme.primary,
                  opacity: !manualPayload.trim() || pairingInFlight ? 0.55 : 1,
                  paddingHorizontal: 16,
                  paddingVertical: 11,
                })}
              >
                <SFSymbol name="qrcode.viewfinder" size={16} color={theme.primaryText} />
                <Text style={{ color: theme.primaryText, fontWeight: "700", fontSize: 14 }}>
                  Pair pasted payload
                </Text>
              </Pressable>
            </View>
            <Text
              selectable
              style={{
                color: scannedPayload ? theme.text : theme.textTertiary,
                fontSize: 12,
                lineHeight: 18,
                fontVariant: ["tabular-nums"],
                fontFamily: theme.fontFamilyMono,
              }}
            >
              {scannedPayload ?? "No QR scanned yet."}
            </Text>
          </SectionCard>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
