import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
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

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [pedas, setPedas] = useState<NearbyPeda[]>([]);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeda, setSelectedPeda] = useState<NearbyPeda | null>(null);
  const [joining, setJoining] = useState(false);

  async function getUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setUserLocation(MAZATLAN);
      return MAZATLAN;
    }
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

  async function loadMap() {
    setLoading(true);
    const coords = await getUserLocation();
    await fetchPedas(coords.latitude, coords.longitude);
    setLoading(false);
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
    await supabase
      .from("peda_attendees")
      .upsert({ peda_id: peda.id, user_id: user.id });
    setJoining(false);
    setSelectedPeda(null);
    router.push(`/peda/${peda.id}`);
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
        <Text style={styles.loadingText}>Cargando mapa...</Text>
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
            <HeatBadge attendeeCount={peda.attendee_count} />
          </Marker>
        ))}
      </MapView>

      {/* Recenter button */}
      <TouchableOpacity
        style={styles.recenterBtn}
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

      {/* Create peda FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/create-peda")}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={colors.text} />
      </TouchableOpacity>

      {/* Selected peda card */}
      {selectedPeda && (
        <View style={styles.pedaCard}>
          <TouchableOpacity
            style={styles.pedaCardClose}
            onPress={() => setSelectedPeda(null)}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.pedaName}>{selectedPeda.name}</Text>

          <View style={styles.pedaInfo}>
            <View style={styles.pedaInfoRow}>
              <Ionicons name="people" size={16} color={colors.textSecondary} />
              <Text style={styles.pedaInfoText}>
                {selectedPeda.attendee_count} personas
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
            title="Unirse a la peda"
            onPress={() => joinPeda(selectedPeda)}
            loading={joining}
          />
        </View>
      )}

      {pedas.length === 0 && !loading && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>No hay pedas cerca</Text>
          <Text style={styles.emptySubtext}>Crea la primera</Text>
        </View>
      )}
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
  recenterBtn: {
    position: "absolute",
    top: 60,
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
  fab: {
    position: "absolute",
    bottom: 100,
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
    bottom: 100,
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
});
