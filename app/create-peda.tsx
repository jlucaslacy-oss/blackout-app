import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { customAlphabet } from "nanoid/non-secure";
import { supabase } from "../lib/supabase";
import Button from "../components/Button";
import Input from "../components/Input";
import { colors, spacing, fonts, radii } from "../components/theme";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

const DURATION_OPTIONS = [
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
];

export default function CreatePedaScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState({ latitude: 23.2494, longitude: -106.4111 });
  const [address, setAddress] = useState("");
  const [durationHours, setDurationHours] = useState(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [inviteCode] = useState(generateCode());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPin({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      if (results.length > 0) {
        const r = results[0];
        const parts = [r.street, r.district, r.city].filter(Boolean);
        setAddress(parts.join(", "));
      }
    } catch {
      setAddress("");
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert("Error", "Dale un nombre a tu peda");
      return;
    }

    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 3600_000);

    const { data, error } = await supabase
      .from("pedas")
      .insert({
        name: name.trim(),
        location: `POINT(${pin.longitude} ${pin.latitude})`,
        address: address || null,
        starts_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        is_private: isPrivate,
        invite_code: isPrivate ? inviteCode : null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      Alert.alert("Error", error.message);
      setLoading(false);
      return;
    }

    await supabase
      .from("peda_attendees")
      .insert({ peda_id: data.id, user_id: user.id });

    setLoading(false);
    router.replace(`/peda/${data.id}`);
  }

  const mapRegion: Region = {
    ...pin,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nueva Peda</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        <Input
          label="Nombre de la peda"
          placeholder="Ej: Peda en casa de Juan"
          value={name}
          onChangeText={(t) => setName(t.slice(0, 60))}
          maxLength={60}
        />

        <Text style={styles.sectionLabel}>Ubicación</Text>
        <View style={styles.mapContainer}>
          <MapView
            style={styles.miniMap}
            region={mapRegion}
            userInterfaceStyle="dark"
            scrollEnabled
            zoomEnabled
            onRegionChangeComplete={(region) => {
              setPin({
                latitude: region.latitude,
                longitude: region.longitude,
              });
              reverseGeocode(region.latitude, region.longitude);
            }}
          >
            <Marker coordinate={pin} draggable onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setPin({ latitude, longitude });
              reverseGeocode(latitude, longitude);
            }} />
          </MapView>
        </View>
        {address ? (
          <Text style={styles.addressText}>{address}</Text>
        ) : null}

        <Text style={styles.sectionLabel}>Duración</Text>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.hours}
              style={[
                styles.durationChip,
                durationHours === opt.hours && styles.durationChipActive,
              ]}
              onPress={() => setDurationHours(opt.hours)}
            >
              <Text
                style={[
                  styles.durationText,
                  durationHours === opt.hours && styles.durationTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.privateRow}>
          <View style={styles.privateInfo}>
            <Text style={styles.privateLabel}>Peda privada</Text>
            <Text style={styles.privateDesc}>
              Solo invitados pueden ver el contenido
            </Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.text}
          />
        </View>

        {isPrivate && (
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Código de invitación</Text>
            <Text style={styles.code}>{inviteCode}</Text>
            <Text style={styles.codeHint}>
              Comparte este código con tus amigos
            </Text>
          </View>
        )}

        <Button
          title="Crear peda"
          onPress={handleCreate}
          loading={loading}
          disabled={!name.trim()}
          style={styles.createBtn}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: fonts.title,
    fontWeight: "800",
    color: colors.text,
  },
  form: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
  mapContainer: {
    height: 200,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  miniMap: {
    flex: 1,
  },
  addressText: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: spacing.sm,
  },
  durationRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  durationChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  durationChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  durationText: {
    color: colors.textSecondary,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  durationTextActive: {
    color: colors.text,
  },
  privateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xxl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.md,
  },
  privateInfo: { flex: 1, marginRight: spacing.lg },
  privateLabel: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  privateDesc: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: spacing.xs,
  },
  codeBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: radii.md,
    alignItems: "center",
  },
  codeLabel: {
    color: colors.textSecondary,
    fontSize: fonts.caption,
    marginBottom: spacing.sm,
  },
  code: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.accent,
    letterSpacing: 6,
  },
  codeHint: {
    color: colors.textDim,
    fontSize: fonts.caption,
    marginTop: spacing.sm,
  },
  createBtn: {
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxxl,
  },
});
