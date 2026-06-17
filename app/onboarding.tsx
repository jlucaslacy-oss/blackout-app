import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Camera } from "expo-camera";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import Button from "../components/Button";
import { colors, spacing, fonts, radii } from "../components/theme";

type Step = "age" | "eula" | "permissions";

const EULA_TEXT = `TÉRMINOS Y CONDICIONES DE USO — Blackout

1. ACEPTACIÓN
Al usar Blackout, aceptas estos términos. Si no estás de acuerdo, no uses la app.

2. REQUISITOS
Debes tener 18 años o más. Al registrarte, confirmas que cumples este requisito.

3. CONTENIDO
Todo el contenido subido es efímero y se elimina automáticamente después de 24 horas. Eres responsable del contenido que subes. No se permite:
- Contenido sexual explícito o desnudos
- Violencia o amenazas
- Acoso o intimidación
- Contenido que involucre menores de edad
- Contenido ilegal

4. POLÍTICA DE CERO TOLERANCIA
Blackout tiene una política de cero tolerancia hacia contenido objetable o abusivo. Las violaciones resultarán en la eliminación inmediata del contenido y posible suspensión de la cuenta.

5. PRIVACIDAD
Tu ubicación se usa para mostrarte pedas cercanas. No vendemos tus datos a terceros. Las fotos y videos se almacenan temporalmente (24h) y luego se eliminan.

6. MODERACIÓN
Nos reservamos el derecho de eliminar contenido y suspender cuentas que violen estos términos. Los reportes se revisan en menos de 24 horas.

7. ELIMINACIÓN DE CUENTA
Puedes eliminar tu cuenta en cualquier momento desde la configuración de tu perfil. Todos tus datos serán eliminados permanentemente.

8. CAMBIOS
Podemos modificar estos términos. Te notificaremos de cambios significativos.

9. LIMITACIÓN DE RESPONSABILIDAD
Blackout no se hace responsable de las acciones de otros usuarios ni del contenido que suban.

Última actualización: Junio 2026`;

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("age");
  const [birthdate, setBirthdate] = useState(new Date(2000, 0, 1));
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [eulaScrolled, setEulaScrolled] = useState(false);
  const [loading, setLoading] = useState(false);

  function getAge(date: Date): number {
    const today = new Date();
    let age = today.getFullYear() - date.getFullYear();
    const monthDiff = today.getMonth() - date.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
      age--;
    }
    return age;
  }

  async function handleAgeNext() {
    const age = getAge(birthdate);
    if (age < 18) {
      Alert.alert(
        "Acceso denegado",
        "Debes tener 18 años o más para usar Blackout."
      );
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ birthdate: birthdate.toISOString().split("T")[0] })
        .eq("id", user.id);
    }
    setLoading(false);
    setStep("eula");
  }

  async function handleEulaAccept() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ eula_accepted_at: new Date().toISOString() })
        .eq("id", user.id);
    }
    setLoading(false);
    setStep("permissions");
  }

  async function handlePermissions() {
    await Camera.requestCameraPermissionsAsync();
    await Camera.requestMicrophonePermissionsAsync();
    await Location.requestForegroundPermissionsAsync();
    if (Platform.OS !== "web") {
      await Notifications.requestPermissionsAsync();
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("Error", "No hay usuario autenticado");
      setLoading(false);
      return;
    }

    const { data: profile, error: fetchErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const { error: insertErr } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          username: user.email?.split("@")[0] || `user_${user.id.slice(0, 8)}`,
          onboarding_completed: true,
          birthdate: birthdate.toISOString().split("T")[0],
          eula_accepted_at: new Date().toISOString(),
        });
      if (insertErr) {
        Alert.alert("Error creando perfil", insertErr.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", user.id);
      if (updateErr) {
        Alert.alert("Error actualizando perfil", updateErr.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    router.replace("/(tabs)/map");
  }

  function handleEulaScroll(event: any) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 50;
    if (nearBottom) setEulaScrolled(true);
  }

  return (
    <SafeAreaView style={styles.container}>
      {step === "age" && (
        <View style={styles.content}>
          <Text style={styles.stepTitle}>Verifica tu edad</Text>
          <Text style={styles.stepDesc}>
            Debes tener 18 años o más para usar Blackout
          </Text>

          <View style={styles.datePickerContainer}>
            <DateTimePicker
              value={birthdate}
              mode="date"
              display="spinner"
              onChange={(_, date) => date && setBirthdate(date)}
              maximumDate={new Date()}
              minimumDate={new Date(1940, 0, 1)}
              textColor={colors.text}
              themeVariant="dark"
            />
          </View>

          <Button
            title="Continuar"
            onPress={handleAgeNext}
            loading={loading}
          />
        </View>
      )}

      {step === "eula" && (
        <View style={styles.content}>
          <Text style={styles.stepTitle}>Términos y condiciones</Text>

          <ScrollView
            style={styles.eulaScroll}
            onScroll={handleEulaScroll}
            scrollEventThrottle={200}
          >
            <Text style={styles.eulaText}>{EULA_TEXT}</Text>
          </ScrollView>

          <View style={styles.eulaActions}>
            <Button
              title={
                eulaAccepted
                  ? "✓ Acepto los términos"
                  : "Acepto los términos y condiciones"
              }
              variant={eulaAccepted ? "primary" : "outline"}
              onPress={() => setEulaAccepted(!eulaAccepted)}
              disabled={!eulaScrolled}
            />
            <View style={styles.spacer} />
            <Button
              title="Continuar"
              onPress={handleEulaAccept}
              loading={loading}
              disabled={!eulaAccepted}
            />
          </View>
        </View>
      )}

      {step === "permissions" && (
        <View style={styles.content}>
          <Text style={styles.stepTitle}>Permisos</Text>
          <Text style={styles.stepDesc}>
            Blackout necesita estos permisos para funcionar
          </Text>

          <View style={styles.permCards}>
            <View style={styles.permCard}>
              <Ionicons name="camera" size={32} color={colors.accent} />
              <View style={styles.permInfo}>
                <Text style={styles.permTitle}>Cámara y micrófono</Text>
                <Text style={styles.permDesc}>
                  Para capturar fotos y videos en las pedas
                </Text>
              </View>
            </View>
            <View style={styles.permCard}>
              <Ionicons name="location" size={32} color={colors.accent} />
              <View style={styles.permInfo}>
                <Text style={styles.permTitle}>Ubicación</Text>
                <Text style={styles.permDesc}>
                  Para mostrarte pedas cercanas en el mapa
                </Text>
              </View>
            </View>
            <View style={styles.permCard}>
              <Ionicons name="notifications" size={32} color={colors.accent} />
              <View style={styles.permInfo}>
                <Text style={styles.permTitle}>Notificaciones</Text>
                <Text style={styles.permDesc}>
                  Para avisarte cuando hay pedas cerca
                </Text>
              </View>
            </View>
          </View>

          <Button
            title="Permitir y continuar"
            onPress={handlePermissions}
            loading={loading}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  stepTitle: {
    fontSize: fonts.title,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  stepDesc: {
    fontSize: fonts.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xxxl,
  },
  datePickerContainer: {
    marginBottom: spacing.xxxl,
  },
  eulaScroll: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  eulaText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    lineHeight: 22,
  },
  eulaActions: {
    paddingTop: spacing.sm,
  },
  spacer: { height: spacing.sm },
  permCards: { gap: spacing.lg, marginBottom: spacing.xxxl },
  permCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.md,
  },
  permInfo: { flex: 1 },
  permTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  permDesc: {
    color: colors.textMuted,
    fontSize: fonts.small,
    marginTop: spacing.xs,
  },
});
