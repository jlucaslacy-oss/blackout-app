import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Callout, Region } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { NearbyPeda } from "../../lib/types";
import HeatBadge from "../../components/HeatBadge";
import TimeLeft from "../../components/TimeLeft";
import Button from "../../components/Button";
import { colors, spacing, fonts, radii } from "../../components/theme";

const MAZATLAN = { latitude: 23.2494, longitude: -106.4111 };

// Space reserved above the safe-area bottom inset for the tab bar.
const TAB_BAR_ALLOWANCE = 100;

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const hasLoadedOnce = useRef(false);
  const [pedas, setPedas] = useState<NearbyPeda[]>([]);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeda, setSelectedPeda] = useState<NearbyPeda | null>(null);
  const [joining, setJoining] = useState(false);
  const [codeModalVisible, setCodeModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningByCode, setJoiningByCode] = useState(false);
  const [myPedaIds, setMyPedaIds] = useState<Set<string>>(new Set());
  const [locationDenied, setLocationDenied] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  async function getUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocationDenied(true);
      setUserLocation(MAZATLAN);
      return MAZATLAN;
    }
    setLocationDenied(false);
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
    setUserLocation(coords);
    return coords;
  }

  async function fetchPedas(lat: number, lng: number) {
    const { data, error } = await supabase.rpc("nearby_pedas", {
      user_lat: lat,
      user_lng: lng,
      radius_km: 10,
    });
    if (error) {
      console.error("Error fetching pedas:", error);
      return;
    }
    setPedas((data as NearbyPeda[]) || []);
  }

  async function fetchMyPedas() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("peda_attendees")
      .select("peda_id")
      .eq("user_id", user.id);
    if (data) setMyPedaIds(new Set(data.map((r) => r.peda_id)));
  }

  async function loadMap() {
    // Full-screen loader only on the very first load; on subsequent tab
    // focuses refresh silently so the map stays rendered.
    const isFirstLoad = !hasLoadedOnce.current;
    if (isFirstLoad) setLoading(true);
    const coords = await getUserLocation();
    await Promise.all([
      fetchPedas(coords.latitude, coords.longitude),
      fetchMyPedas(),
    ]);
    hasLoadedOnce.current = true;
    if (isFirstLoad) setLoading(false);
  }

  useFocusEffect(
    useCallback(() => {
      loadMap();
    }, [])
  );

  useEffect(() => {
    if (!userLocation) return;
    const interval = setInterval(() => {
      fetchPedas(userLocation.latitude, userLocation.longitude);
    }, 30_000);
    return () => clearInterval(interval);
  }, [userLocation]);

  async function joinPeda(peda: NearbyPeda) {
    setJoining(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setJoining(false);
      return;
    }
    const { error } = await supabase
      .from("peda_attendees")
      .upsert({ peda_id: peda.id, user_id: user.id });
    setJoining(false);
    if (error) {
      Alert.alert("Ups", "No pudimos unirte a la peda. Inténtalo de nuevo.");
      return;
    }
    setSelectedPeda(null);
    router.push(`/peda/${peda.id}`);
  }

  async function joinByCode() {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    setJoiningByCode(true);
    const { data, error } = await supabase.rpc("join_peda_by_code", { code });
    setJoiningByCode(false);
    if (error) {
      Alert.alert("Ups", "Código inválido o la peda ya terminó.");
      return;
    }
    setCodeModalVisible(false);
    setInviteCode("");
    router.push(`/peda/${data}`);
  }

  const initialRegion: Region = {
    latitude: userLocation?.latitude ?? MAZATLAN.latitude,
    longitude: userLocation?.longitude ?? MAZATLAN.longitude,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Cargando el mapa...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        userInterfaceStyle="dark"
      >
        {pedas.map((peda) => (
          <Marker
            key={peda.id}
            coordinate={{ latitude: peda.lat, longitude: peda.lng }}
            onPress={() => setSelectedPeda(peda)}
          >
            <HeatBadge attendeeCount={peda.attendee_count} emoji={peda.emoji} />
          </Marker>
        ))}
      </MapView>

      {/* Location permission banner */}
      {locationDenied && !bannerDismissed && (
        <View style={[styles.locationBanner, { top: insets.top + spacing.sm }]}>
          <Ionicons name="location-outline" size={18} color={colors.text} />
          <Text style={styles.locationBannerText}>
            Activa tu ubicación para ver pedas cerca
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openSettings()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Abrir ajustes de ubicación"
          >
            <Text style={styles.locationBannerAction}>Ajustes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBannerDismissed(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Cerrar aviso de ubicación"
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Recenter button */}
      <TouchableOpacity
        style={[styles.recenterBtn, { top: insets.top + spacing.md }]}
        accessibilityLabel="Centrar el mapa en tu ubicación"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={() => {
          if (userLocation && mapRef.current) {
            mapRef.current.animateToRegion({
              ...userLocation,
              latitudeDelta: 0.04,
              longitudeDelta: 0.04,
            });
          }
        }}
      >
        <Ionicons name="locate" size={22} color={colors.text} />
      </TouchableOpacity>

      {/* Join by code button */}
      <TouchableOpacity
        style={[styles.codeBtn, { top: insets.top + spacing.md }]}
        accessibilityLabel="Unirte a una peda con código"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={() => setCodeModalVisible(true)}
      >
        <Ionicons name="ticket-outline" size={22} color={colors.text} />
      </TouchableOpacity>

      {/* Create peda FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + TAB_BAR_ALLOWANCE }]}
        accessibilityLabel="Crear una peda"
        onPress={() => router.push("/create-peda")}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={colors.background} />
      </TouchableOpacity>

      {/* Selected peda card */}
      {selectedPeda && (
        <View style={[styles.pedaCard, { bottom: insets.bottom + TAB_BAR_ALLOWANCE }]}>
          <TouchableOpacity
            style={styles.pedaCardClose}
            onPress={() => setSelectedPeda(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Cerrar tarjeta de la peda"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.pedaName}>{selectedPeda.name}</Text>

          <View style={styles.pedaInfo}>
            <View style={styles.pedaInfoRow}>
              <Ionicons name="people" size={16} color={colors.textSecondary} />
              <Text style={styles.pedaInfoText}>
                {selectedPeda.attendee_count}{" "}
                {selectedPeda.attendee_count === 1 ? "persona" : "personas"}
              </Text>
            </View>
            <View style={styles.pedaInfoRow}>
              <Ionicons name="time" size={16} color={colors.accent} />
              <TimeLeft expiresAt={selectedPeda.expires_at} />
            </View>
            {selectedPeda.address && (
              <View style={styles.pedaInfoRow}>
                <Ionicons name="location" size={16} color={colors.textSecondary} />
                <Text style={styles.pedaInfoText} numberOfLines={1}>
                  {selectedPeda.address}
                </Text>
              </View>
            )}
            <Text style={styles.pedaDistance}>
              {selectedPeda.distance_km < 1
                ? `${Math.round(selectedPeda.distance_km * 1000)}m`
                : `${selectedPeda.distance_km.toFixed(1)}km`}
            </Text>
          </View>

          <Button
            title={myPedaIds.has(selectedPeda.id) ? "Entrar" : "Únete a la peda"}
            onPress={() => {
              if (myPedaIds.has(selectedPeda.id)) {
                setSelectedPeda(null);
                router.push(`/peda/${selectedPeda.id}`);
              } else {
                joinPeda(selectedPeda);
              }
            }}
            loading={joining}
          />
        </View>
      )}

      {pedas.length === 0 && !loading && (
        <View style={styles.emptyOverlay} pointerEvents="box-none">
          <Text style={styles.emptyText}>No hay pedas cerca</Text>
          <Text style={styles.emptySubtext}>Sé quien prenda la noche</Text>
          <Button
            title="Crea la primera"
            onPress={() => router.push("/create-peda")}
            style={styles.emptyBtn}
          />
        </View>
      )}

      {/* Invite code modal */}
      <Modal visible={codeModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.codeOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity
            style={styles.codeBackdrop}
            activeOpacity={1}
            onPress={() => {
              setCodeModalVisible(false);
              setInviteCode("");
            }}
          />
          <View style={styles.codeSheet}>
            <View style={styles.codeHandle} />
            <Text style={styles.codeTitle}>Únete con código</Text>
            <Text style={styles.codeDesc}>
              Pídele el código de invitación a quien creó la peda privada
            </Text>
            <TextInput
              style={styles.codeInput}
              value={inviteCode}
              onChangeText={(t) => setInviteCode(t.toUpperCase())}
              placeholder="CÓDIGO"
              placeholderTextColor={colors.textDim}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={joinByCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              textAlign="center"
            />
            <Button
              title="Entrar"
              onPress={joinByCode}
              loading={joiningByCode}
              disabled={inviteCode.trim().length < 4}
              style={styles.codeJoinBtn}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
  },
  loadingText: { color: colors.textSecondary, fontSize: fonts.body },
  locationBanner: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg + 44 + spacing.sm + 44 + spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  locationBannerText: {
    flex: 1,
    color: colors.text,
    fontSize: fonts.caption,
  },
  locationBannerAction: {
    color: colors.accent,
    fontSize: fonts.caption,
    fontWeight: "700",
  },
  recenterBtn: {
    position: "absolute",
    right: spacing.lg,
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  codeBtn: {
    position: "absolute",
    right: spacing.lg + 44 + spacing.sm,
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  fab: {
    position: "absolute",
    right: spacing.xl,
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  pedaCard: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pedaCardClose: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 1,
  },
  pedaName: {
    fontSize: fonts.title,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.md,
  },
  pedaInfo: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  pedaInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pedaInfoText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    flex: 1,
  },
  pedaDistance: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: spacing.xs,
  },
  emptyOverlay: {
    position: "absolute",
    top: "40%",
    alignSelf: "center",
    alignItems: "center",
  },
  emptyText: {
    color: colors.text,
    fontSize: fonts.title,
    fontWeight: "700",
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: fonts.body,
    marginTop: spacing.sm,
  },
  emptyBtn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
  },
  codeOverlay: {
    flex: 1,
  },
  codeBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  codeSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: 50,
  },
  codeHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
    alignSelf: "center",
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  codeTitle: {
    color: colors.text,
    fontSize: fonts.title,
    fontWeight: "800",
    textAlign: "center",
  },
  codeDesc: {
    color: colors.textMuted,
    fontSize: fonts.small,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  codeInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 8,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: "center",
  },
  codeJoinBtn: {
    marginTop: spacing.lg,
  },
});
