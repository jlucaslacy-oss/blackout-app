import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";
import { supabase } from "../../lib/supabase";
import { Post } from "../../lib/types";
import { notify } from "../../lib/notifications";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import CommentSheet from "../../components/CommentSheet";
import { colors, spacing, fonts } from "../../components/theme";

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

function PostVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView style={styles.media} player={player} nativeControls />;
}

export default function PostScreen() {
  const { id: postId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const fetchPost = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) setMyId(user.id);

    const { data } = await supabase
      .from("posts")
      .select("*, profiles(*), pedas:peda_id(is_private, expires_at)")
      .eq("id", postId)
      .eq("moderation_status", "approved")
      .maybeSingle();

    if (!data) {
      setNotFound(true);
      return;
    }

    // Same visibility rules as the feed/profile grids
    const now = new Date().toISOString();
    const peda = (data as any).pedas;
    if (data.peda_id && (peda?.is_private || (peda?.expires_at && peda.expires_at < now))) {
      setNotFound(true);
      return;
    }

    let likedByMe = false;
    if (user) {
      const { data: like } = await supabase
        .from("likes")
        .select("id")
        .eq("user_id", user.id)
        .eq("post_id", postId)
        .maybeSingle();
      likedByMe = !!like;
    }

    setPost({ ...(data as Post), liked_by_me: likedByMe });
  }, [postId]);

  useEffect(() => {
    fetchPost().finally(() => setLoading(false));
  }, [fetchPost]);

  async function toggleLike() {
    if (!post) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasLiked = !!post.liked_by_me;
    // Optimistic flip
    setPost((prev) =>
      prev
        ? {
            ...prev,
            liked_by_me: !wasLiked,
            like_count: Math.max(0, prev.like_count + (wasLiked ? -1 : 1)),
          }
        : prev
    );
    const { data, error } = await supabase.rpc("toggle_like", {
      target_post_id: post.id,
    });
    if (error) {
      // Roll back
      setPost((prev) =>
        prev
          ? {
              ...prev,
              liked_by_me: wasLiked,
              like_count: Math.max(0, prev.like_count + (wasLiked ? 1 : -1)),
            }
          : prev
      );
      return;
    }
    const liked = data as boolean;
    if (liked !== !wasLiked) {
      // Reconcile with the server result
      setPost((prev) =>
        prev
          ? {
              ...prev,
              liked_by_me: liked,
              like_count: Math.max(0, prev.like_count + (liked ? 1 : -1)),
            }
          : prev
      );
    }
    if (liked && !wasLiked && post.user_id !== myId) {
      notify(post.user_id, "like", { postId: post.id });
    }
  }

  function goToAuthor() {
    if (!post) return;
    if (post.user_id === myId) {
      router.push("/(tabs)/profile");
    } else {
      router.push(`/user/${post.user_id}`);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !post) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => router.back()}
          hitSlop={HIT_SLOP}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Ionicons name="image-outline" size={48} color={colors.textDimmer} />
          <Text style={styles.notFoundTitle}>
            Este post ya no está disponible
          </Text>
          <Button
            title="Volver"
            variant="outline"
            onPress={() => router.back()}
            style={styles.backBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.authorRow}
          onPress={goToAuthor}
          activeOpacity={0.7}
        >
          <Avatar
            username={post.profiles?.username ?? "?"}
            avatarUrl={post.profiles?.avatar_url}
            size="sm"
          />
          <Text style={styles.authorName}>{post.profiles?.username}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} hitSlop={HIT_SLOP}>
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.mediaContainer}>
        {post.media_type === "video" ? (
          <PostVideoPlayer uri={post.media_url} />
        ) : (
          <Image
            source={{ uri: post.media_url }}
            style={styles.media}
            contentFit="contain"
            placeholder={post.blur_data ? { uri: post.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
            placeholderContentFit="contain"
            transition={300}
          />
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={toggleLike}>
          <Ionicons
            name={post.liked_by_me ? "heart" : "heart-outline"}
            size={26}
            color={post.liked_by_me ? colors.error : colors.text}
          />
          {post.like_count > 0 && (
            <Text style={styles.actionCount}>{post.like_count}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setCommentPostId(post.id)}
        >
          <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          {post.comment_count > 0 && (
            <Text style={styles.actionCount}>{post.comment_count}</Text>
          )}
        </TouchableOpacity>
      </View>

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionUser}>
            {post.profiles?.username}{" "}
          </Text>
          {post.caption}
        </Text>
      ) : null}

      <CommentSheet
        postId={commentPostId}
        postOwnerId={post.user_id}
        visible={!!commentPostId}
        onClose={() => setCommentPostId(null)}
        onCommentAdded={() => {
          setPost((prev) =>
            prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  closeBtn: {
    position: "absolute",
    top: spacing.xxl * 2,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  notFoundTitle: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "600",
    textAlign: "center",
  },
  backBtn: {
    marginTop: spacing.md,
    alignSelf: "stretch",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    minHeight: 44,
  },
  authorName: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  mediaContainer: {
    flex: 1,
  },
  media: {
    flex: 1,
    width: "100%",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  actionCount: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
  },
  caption: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  captionUser: {
    fontWeight: "700",
    color: colors.text,
  },
});
