import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Post } from "../../lib/types";
import Avatar from "../../components/Avatar";
import CommentSheet from "../../components/CommentSheet";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width } = Dimensions.get("window");

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

export default function FeedScreen() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const fetchFeed = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("posts")
      .select("*, profiles(*)")
      .is("peda_id", null)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!data) return;

    const postIds = data.map((p: any) => p.id);
    let likedSet = new Set<string>();
    if (postIds.length > 0) {
      const { data: likes } = await supabase
        .from("likes")
        .select("post_id")
        .eq("user_id", user.id)
        .in("post_id", postIds);
      if (likes) likedSet = new Set(likes.map((l: any) => l.post_id));
    }

    setPosts(
      data.map((p: any) => ({ ...p, liked_by_me: likedSet.has(p.id) })) as Post[]
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchFeed();
    }, [fetchFeed])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  }

  async function toggleLike(postId: string) {
    const { data } = await supabase.rpc("toggle_like", {
      target_post_id: postId,
    });
    const liked = data as boolean;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              liked_by_me: liked,
              like_count: liked ? p.like_count + 1 : p.like_count - 1,
            }
          : p
      )
    );
  }

  function renderPost({ item }: { item: Post }) {
    const isOwn = item.user_id === userId;
    return (
      <View style={styles.postCard}>
        <TouchableOpacity
          style={styles.postHeader}
          onPress={() =>
            isOwn
              ? router.push("/(tabs)/profile")
              : router.push(`/user/${item.user_id}`)
          }
        >
          <Avatar
            username={item.profiles?.username ?? "?"}
            avatarUrl={item.profiles?.avatar_url}
            size="sm"
          />
          <View style={styles.postHeaderText}>
            <Text style={styles.postUsername}>
              {item.profiles?.username}
            </Text>
            <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </TouchableOpacity>

        <Image
          source={{ uri: item.media_url }}
          style={styles.postImage}
          resizeMode="cover"
        />

        <View style={styles.postActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => toggleLike(item.id)}
          >
            <Ionicons
              name={item.liked_by_me ? "heart" : "heart-outline"}
              size={24}
              color={item.liked_by_me ? colors.error : colors.text}
            />
            {item.like_count > 0 && (
              <Text style={styles.actionCount}>{item.like_count}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setCommentPostId(item.id)}
          >
            <Ionicons
              name="chatbubble-outline"
              size={22}
              color={colors.text}
            />
            {item.comment_count > 0 && (
              <Text style={styles.actionCount}>{item.comment_count}</Text>
            )}
          </TouchableOpacity>
        </View>

        {item.caption ? (
          <Text style={styles.caption}>
            <Text style={styles.captionUser}>
              {item.profiles?.username}{" "}
            </Text>
            {item.caption}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.logoRow}>
          <Ionicons name="flash" size={20} color={colors.text} />
          <Text style={styles.logoBlack}>BLACK</Text>
          <Text style={styles.logoOut}>OUT</Text>
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            onPress={() => router.push("/follow-requests")}
          >
            <Ionicons
              name="people-outline"
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/camera")}
          >
            <Ionicons
              name="add-circle-outline"
              size={26}
              color={colors.text}
            />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="image-outline"
              size={48}
              color={colors.textDimmer}
            />
            <Text style={styles.emptyTitle}>Tu feed está vacío</Text>
            <Text style={styles.emptySubtext}>
              Sigue a personas para ver sus fotos aquí
            </Text>
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyList : undefined}
      />

      <CommentSheet
        postId={commentPostId}
        visible={!!commentPostId}
        onClose={() => setCommentPostId(null)}
        onCommentAdded={() => {
          setPosts((prev) =>
            prev.map((p) =>
              p.id === commentPostId
                ? { ...p, comment_count: p.comment_count + 1 }
                : p
            )
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  logoBlack: {
    fontSize: fonts.body,
    fontWeight: "900",
    color: colors.text,
    letterSpacing: 2,
  },
  logoOut: {
    fontSize: fonts.body,
    fontWeight: "900",
    color: colors.textFade,
    letterSpacing: 2,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  postCard: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  postHeaderText: {
    flex: 1,
  },
  postUsername: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  postTime: {
    color: colors.textDim,
    fontSize: fonts.caption,
  },
  postImage: {
    width,
    height: width,
    backgroundColor: colors.surface,
  },
  postActions: {
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.md,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  actionCount: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
  },
  caption: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  captionUser: {
    fontWeight: "700",
    color: colors.text,
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
  },
  emptyList: {
    flex: 1,
  },
});
