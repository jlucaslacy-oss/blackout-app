import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Region } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { customAlphabet } from "nanoid/non-secure";
import { supabase } from "../lib/supabase";
import Button from "../components/Button";
import Input from "../components/Input";
import { colors, spacing, fonts, radii } from "../components/theme";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

const EMOJI_OPTIONS = [
  "🎉", "🔥", "🍻", "🎶", "🪩", "💀", "👻", "🌙",
  "⚡", "🎤", "🍾", "🥂", "🎊", "💃", "🕺", "🌮",
  "🎸", "🏖️", "🌴", "🎯", "🪅", "🍺", "🎭", "🤙",
];

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
  const [emoji, setEmoji] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [inviteCode] = useState(generateCode());
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const userMovedMap = useRef(false);
  const geocodeSeq = useRef(0);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      // If the user already dragged the map to the party spot, don't yank
      // the pin back to their GPS position.
      if (userMovedMap.current) return;
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setPin(coords);
      mapRef.current?.animateToRegion(
        { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400
      );
      // Fill in the address right away instead of waiting for a map move.
      reverseGeocode(coords.latitude, coords.longitude);
    })();
  }, []);

  function reverseGeocode(lat: number, lng: number) {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      const seq = ++geocodeSeq.current;
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lng,
        });
        // Ignore out-of-order responses from older pin positions
        if (seq !== geocodeSeq.current) return;
        if (results.length > 0) {
          const r = results[0];
          const parts = [r.street, r.district, r.city].filter(Boolean);
          setAddress(parts.join(", "));
        }
      } catch {
        // Keep the last good address instead of blanking it
      }
    }, 400);
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert("Ups", "Ponle nombre a tu peda");
      return;
    }
    if (!emoji) {
      Alert.alert("Ups", "Elige un emoji para tu peda");
      setEmojiOpen(true);
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
        emoji,
        is_private: isPrivate,
        invite_code: isPrivate ? inviteCode : null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      Alert.alert("Ups", "No se pudo crear la peda. Inténtalo de nuevo.");
      setLoading(false);
      return;
    }

    await supabase
      .from("peda_attendees")
      .insert({ peda_id: data.id, user_id: user.id });

    setLoading(false);
    router.replace(`/peda/${data.id}`);
  }

  // Uncontrolled map (initialRegion + ref): a controlled `region` with fixed
  // deltas snaps the zoom back after every pinch.
  const initialRegion = useRef<Region>({
    ...pin,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  }).current;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Cerrar"
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nueva peda</Text>
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

        <TouchableOpacity
          style={styles.emojiToggle}
          onPress={() => setEmojiOpen((o) => !o)}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionLabel}>Emoji</Text>
          <View style={styles.emojiToggleRight}>
            {emoji ? (
              <Text style={styles.emojiSelected}>{emoji}</Text>
            ) : (
              <Text style={styles.emojiPlaceholder}>Elegir</Text>
            )}
            <Ionicons
              name={emojiOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textDim}
            />
          </View>
        </TouchableOpacity>
        {emojiOpen && (
          <View style={styles.emojiGrid}>
            {EMOJI_OPTIONS.map((e) => (
              <TouchableOpacity
                key={e}
                style={[
                  styles.emojiChip,
                  emoji === e && styles.emojiChipActive,
                ]}
                onPress={() => {
                  setEmoji(e);
                  setEmojiOpen(false);
                }}
              >
                <Text style={styles.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.sectionLabel}>Ubicación</Text>
        <Text style={styles.mapHint}>Mueve el mapa para ajustar el pin</Text>
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.miniMap}
            initialRegion={initialRegion}
            userInterfaceStyle="dark"
            scrollEnabled
            zoomEnabled
            onRegionChangeComplete={(region, details) => {
              if (details?.isGesture !== false) userMovedMap.current = true;
              setPin({
                latitude: region.latitude,
                longitude: region.longitude,
              });
              reverseGeocode(region.latitude, region.longitude);
            }}
          />
          {/* Fixed center pin: the map moves underneath, the pin stays put */}
          <View style={styles.centerPin} pointerEvents="none">
            <Ionicons name="location-sharp" size={36} color={colors.accent} />
          </View>
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
              Solo los invitados pueden ver el contenido
            </Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={isPrivate ? colors.background : colors.text}
            ios_backgroundColor={colors.border}
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
  emojiToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  emojiToggleRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  emojiSelected: {
    fontSize: 24,
  },
  emojiPlaceholder: {
    color: colors.textDim,
    fontSize: fonts.body,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  emojiChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  emojiText: {
    fontSize: 22,
  },
  mapContainer: {
    height: 200,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  miniMap: {
    flex: 1,
  },
  mapHint: {
    color: colors.textDim,
    fontSize: fonts.caption,
    marginBottom: spacing.sm,
  },
  centerPin: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    // Lift the icon so its tip sits on the map center
    paddingBottom: 32,
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
    color: colors.background,
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
