import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Profile } from "../../lib/types";
import Avatar from "../../components/Avatar";
import { colors, spacing, fonts, radii } from "../../components/theme";

interface Notification {
  id: string;
  user_id: string;
  actor_id: string;
  type: "follow_request" | "follow_accepted" | "like" | "comment";
  post_id: string | null;
  comment_text: string | null;
  read: boolean;
  created_at: string;
  actor?: Profile;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function notificationText(n: Notification): string {
  switch (n.type) {
    case "follow_request":
      return "quiere seguirte";
    case "follow_accepted":
      return "aceptó tu solicitud";
    case "like":
      return "le dio like a tu post";
    case "comment":
      return n.comment_text
        ? `comentó: "${n.comment_text.length > 40 ? n.comment_text.slice(0, 40) + "…" : n.comment_text}"`
        : "comentó tu post";
  }
}

function notificationIcon(type: string): {
  name: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
} {
  switch (type) {
    case "follow_request":
      return { name: "person-add", bg: colors.accent, fg: colors.background };
    case "follow_accepted":
      return {
        name: "checkmark-circle",
        bg: colors.accent,
        fg: colors.background,
      };
    case "like":
      return { name: "heart", bg: colors.error, fg: colors.text };
    case "comment":
      return { name: "chatbubble", bg: colors.accent, fg: colors.background };
    default:
      return { name: "notifications", bg: colors.textMuted, fg: colors.text };
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = Math.max(insets.bottom, 16) + 88;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Ids that were unread at some point this session: they keep their
  // highlight until the user leaves the screen (markAllRead runs on blur).
  const unreadIdsRef = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("notifications")
      .select("*, actor:actor_id(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      const items = data as Notification[];
      for (const n of items) {
        if (!n.read) unreadIdsRef.current.add(n.id);
      }
      setNotifications(items);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchNotifications().finally(() => setLoaded(true));
      return () => {
        // Mark read on blur so highlights survive the session
        markAllRead();
        unreadIdsRef.current = new Set();
      };
    }, [fetchNotifications])
  );

  useEffect(() => {
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.new && (payload.new as any).user_id === userId) {
            fetchNotifications();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchNotifications]);

  async function markAllRead() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  }

  function handlePress(n: Notification) {
    if (n.type === "follow_request") {
      router.push("/follow-requests");
    } else if (n.type === "follow_accepted") {
      router.push(`/user/${n.actor_id}`);
    } else if ((n.type === "like" || n.type === "comment") && n.post_id) {
      router.push(`/post/${n.post_id}`);
    } else {
      router.push(`/user/${n.actor_id}`);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Actividad</Text>
      </View>

      {!loaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => {
            const icon = notificationIcon(item.type);
            const highlighted =
              !item.read || unreadIdsRef.current.has(item.id);
            return (
              <TouchableOpacity
                style={[styles.row, highlighted && styles.rowUnread]}
                onPress={() => handlePress(item)}
                activeOpacity={0.7}
              >
                <View style={styles.avatarWrap}>
                  <Avatar
                    username={item.actor?.username ?? "?"}
                    avatarUrl={item.actor?.avatar_url}
                    size="sm"
                  />
                  <View style={[styles.iconBadge, { backgroundColor: icon.bg }]}>
                    <Ionicons name={icon.name} size={10} color={icon.fg} />
                  </View>
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.rowText}>
                    <Text style={styles.rowUsername}>
                      {item.actor?.username ?? "Alguien"}{" "}
                    </Text>
                    {notificationText(item)}
                  </Text>
                  <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="notifications-off-outline"
                size={48}
                color={colors.textDimmer}
              />
              <Text style={styles.emptyTitle}>Aún no hay notificaciones</Text>
              <Text style={styles.emptySubtext}>
                Cuando alguien interactúe contigo, lo verás aquí
              </Text>
            </View>
          }
          contentContainerStyle={
            notifications.length === 0
              ? styles.emptyList
              : { paddingBottom: tabBarClearance }
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  topBarTitle: {
    color: colors.text,
    fontSize: fonts.title,
    fontWeight: "800",
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowUnread: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  avatarWrap: {
    position: "relative",
  },
  iconBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.background,
  },
  textWrap: {
    flex: 1,
  },
  rowText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    lineHeight: 18,
  },
  rowUsername: {
    color: colors.text,
    fontWeight: "700",
  },
  rowTime: {
    color: colors.textDim,
    fontSize: fonts.caption,
    marginTop: 2,
  },
  empty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: 100,
  },
  emptyTitle: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  emptySubtext: {
    color: colors.textDimmer,
    fontSize: fonts.small,
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },
  emptyList: {
    flex: 1,
  },
});
