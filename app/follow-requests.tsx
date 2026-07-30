import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { Profile } from "../lib/types";
import { notify } from "../lib/notifications";
import Avatar from "../components/Avatar";
import { colors, spacing, fonts, radii } from "../components/theme";

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const SEARCH_DEBOUNCE_MS = 300;

interface FollowRequest {
  id: string;
  follower_id: string;
  status: string;
  profiles: Profile;
}

interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
}

export default function FollowRequestsScreen() {
  const router = useRouter();
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSettled, setSearchSettled] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef("");

  const fetchRequests = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);

    const { data } = await supabase
      .from("follows")
      .select("id, follower_id, status, profiles:follower_id(*)")
      .eq("following_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (data) setRequests(data as unknown as FollowRequest[]);
  }, []);

  useEffect(() => {
    fetchRequests();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchRequests]);

  async function acceptRequest(followId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const request = requests.find((r) => r.id === followId);
    const prevRequests = requests;
    setRequests((prev) => prev.filter((r) => r.id !== followId));
    const { error } = await supabase
      .from("follows")
      .update({ status: "accepted" })
      .eq("id", followId);
    if (error) {
      setRequests(prevRequests);
      Alert.alert("Error", "No se pudo aceptar la solicitud. Intenta de nuevo.");
      return;
    }
    if (request) {
      notify(request.follower_id, "follow_accepted");
    }
  }

  async function declineRequest(followId: string) {
    const prevRequests = requests;
    setRequests((prev) => prev.filter((r) => r.id !== followId));
    const { error } = await supabase
      .from("follows")
      .update({ status: "declined" })
      .eq("id", followId);
    if (error) {
      setRequests(prevRequests);
      Alert.alert("Error", "No se pudo rechazar la solicitud. Intenta de nuevo.");
    }
  }

  function onChangeSearch(query: string) {
    setSearchQuery(query);
    latestQueryRef.current = query;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchSettled(false);
      return;
    }

    setSearching(true);
    setSearchSettled(false);
    debounceRef.current = setTimeout(() => {
      runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  async function runSearch(query: string) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${query.trim()}%`)
      .neq("id", myId)
      .limit(20);
    // Guard against stale out-of-order responses
    if (latestQueryRef.current !== query) return;
    setSearchResults((data as SearchResult[]) ?? []);
    setSearching(false);
    setSearchSettled(true);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={HIT_SLOP}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Gente</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textDim} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={onChangeSearch}
          placeholder="Buscar gente..."
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searching && (
          <ActivityIndicator size="small" color={colors.textDim} />
        )}
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              latestQueryRef.current = "";
              setSearchQuery("");
              setSearchResults([]);
              setSearching(false);
              setSearchSettled(false);
            }}
            hitSlop={HIT_SLOP}
          >
            <Ionicons name="close-circle" size={18} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>

      {searchQuery.trim().length >= 2 ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.userRow}
              onPress={() => router.push(`/user/${item.id}`)}
            >
              <Avatar
                username={item.username}
                avatarUrl={item.avatar_url}
                size="md"
              />
              <Text style={styles.userRowName}>{item.username}</Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textDim}
              />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !searching && searchSettled ? (
              <Text style={styles.emptyText}>No encontramos a nadie</Text>
            ) : null
          }
        />
      ) : (
        <>
          {requests.length > 0 && (
            <Text style={styles.sectionTitle}>
              Solicitudes pendientes ({requests.length})
            </Text>
          )}
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.requestRow}>
                <TouchableOpacity
                  style={styles.requestUser}
                  onPress={() => router.push(`/user/${item.follower_id}`)}
                >
                  <Avatar
                    username={item.profiles?.username ?? "?"}
                    avatarUrl={item.profiles?.avatar_url}
                    size="md"
                  />
                  <Text style={styles.userRowName}>
                    {item.profiles?.username}
                  </Text>
                </TouchableOpacity>
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    onPress={() => acceptRequest(item.id)}
                  >
                    <Ionicons
                      name="checkmark"
                      size={22}
                      color={colors.background}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.declineBtn}
                    onPress={() => declineRequest(item.id)}
                  >
                    <Ionicons name="close" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name="people-outline"
                  size={48}
                  color={colors.textDimmer}
                />
                <Text style={styles.emptyTitle}>No tienes solicitudes</Text>
                <Text style={styles.emptySubtext}>
                  Busca gente para seguir
                </Text>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fonts.small,
    paddingVertical: spacing.md,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    minHeight: 44,
  },
  userRowName: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "600",
    flex: 1,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  requestUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flex: 1,
  },
  requestActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  acceptBtn: {
    backgroundColor: colors.accent,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  declineBtn: {
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  emptySubtext: {
    color: colors.textDimmer,
    fontSize: fonts.small,
  },
  emptyText: {
    color: colors.textDim,
    fontSize: fonts.small,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
});
