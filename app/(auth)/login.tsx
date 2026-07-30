import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { colors, spacing, fonts, radii } from "../../components/theme";

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  async function signInWithApple() {
    if (loading) return;
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        Alert.alert(
          "Ups",
          "No se pudo iniciar sesión con Apple. Inténtalo de nuevo."
        );
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
      if (error) {
        Alert.alert("Ups", "No se pudo iniciar sesión. Inténtalo de nuevo.");
      }
    } catch (e: any) {
      if (e.code !== "ERR_REQUEST_CANCELED") {
        Alert.alert("Ups", "No se pudo iniciar sesión. Inténtalo de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <Ionicons name="flash" size={48} color={colors.text} style={styles.bolt} />
          <View style={styles.logoText}>
            <Text style={styles.logoBlack}>BLACK</Text>
            <Text style={styles.logoOut}>OUT</Text>
          </View>
        </View>

        <Text style={styles.tagline}>WHERE THE NIGHT LIVES</Text>

        {Platform.OS === "ios" && (
          <View style={styles.appleButtonWrap} pointerEvents={loading ? "none" : "auto"}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={radii.sm}
              style={[styles.appleButton, loading && styles.appleButtonLoading]}
              onPress={signInWithApple}
            />
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color={colors.background} />
              </View>
            )}
          </View>
        )}

        <Text style={styles.disclaimer}>
          Solo para mayores de 18 años.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  bolt: {
    marginBottom: spacing.md,
  },
  logoText: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  logoBlack: {
    fontSize: 52,
    fontWeight: "900",
    color: colors.text,
    letterSpacing: 4,
  },
  logoOut: {
    fontSize: 52,
    fontWeight: "900",
    color: colors.textFade,
    letterSpacing: 4,
  },
  tagline: {
    fontSize: fonts.small,
    color: colors.textMuted,
    letterSpacing: 6,
    marginBottom: 80,
    fontWeight: "500",
  },
  appleButtonWrap: {
    width: "100%",
  },
  appleButton: {
    height: 52,
    width: "100%",
  },
  appleButtonLoading: {
    opacity: 0.6,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  disclaimer: {
    color: colors.textDim,
    textAlign: "center",
    fontSize: fonts.caption,
    marginTop: spacing.xxxl,
  },
});
