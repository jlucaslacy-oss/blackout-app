import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Alert,
  Image,
  Modal,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { supabase } from "../../lib/supabase";
import { Peda, Post } from "../../lib/types";
import TimeLeft from "../../components/TimeLeft";
import CommentSheet from "../../components/CommentSheet";
import Button from "../../components/Button";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width } = Dimensions.get("window");
const GRID_SIZE = (width - 3) / 3;

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      style={styles.fullMedia}
      player={player}
      nativeControls
    />
  );
}

export default function PedaViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [peda, setPeda] = useState<Peda | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAttendee, setIsAttendee] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const fetchPeda = useCallback(async () => {
    const { data } = await supabase
      .from("pedas")
      .select("*")
      .eq("id", id)
      .single();
    if (data) setPeda(data as Peda);
  }, [id]);

  const fetchPosts = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("posts")
      .select("*, profiles(*)")
      .eq("peda_id", id)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false });

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
      data.map((p: any) => ({
        ...p,
        liked_by_me: likedSet.has(p.id),
      })) as Post[]
    );
  }, [id]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data } = await supabase
          .from("peda_attendees")
          .select("user_id")
          .eq("peda_id", id)
          .eq("user_id", user.id)
          .maybeSingle();
        setIsAttendee(!!data);
      }
    })();
    fetchPeda();
    fetchPosts();
  }, [id, fetchPeda, fetchPosts]);

  useEffect(() => {
    const channel = supabase
      .channel(`peda-posts-${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "posts",
          filter: `peda_id=eq.${id}`,
        },
        () => fetchPosts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, fetchPosts]);

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
    if (selectedPost?.id === postId) {
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              liked_by_me: liked,
              like_count: liked
                ? prev.like_count + 1
                : prev.like_count - 1,
            }
          : null
      );
    }
  }

  async function handleReport(postId: string) {
    Alert.alert("Reportar contenido", "¿Por qué quieres reportar esto?", [
      {
        text: "Inapropiado",
        onPress: () => submitReport(postId, "inappropriate"),
      },
      { text: "Spam", onPress: () => submitReport(postId, "spam") },
      { text: "Acoso", onPress: () => submitReport(postId, "harassment") },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function submitReport(targetId: string, reason: string) {
    if (!userId) return;
    await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: "post",
      target_id: targetId,
      reason,
    });
    Alert.alert("Gracias", "Tu reporte ha sido enviado");
  }

  async function handleShare() {
    if (!peda) return;
    const message =
      peda.is_private && peda.invite_code
        ? `Únete a mi peda "${peda.name}" en Blackout! Código: ${peda.invite_code}`
        : `Mira esta peda "${peda.name}" en Blackout!`;
    await Share.share({ message });
  }

  const isExpired = peda
    ? new Date(peda.expires_at).getTime() < Date.now()
    : false;

  const renderHeader = () => (
    <View style={styles.headerContent}>
      <View style={styles.pedaMeta}>
        <Text style={styles.pedaName}>{peda?.name ?? "..."}</Text>
        {peda && <TimeLeft expiresAt={peda.expires_at} />}
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Ionicons name="people" size={18} color={colors.textSecondary} />
          <Text style={styles.statText}>{peda?.attendee_count ?? 0}</Text>
        </View>
        <Text style={styles.statText}>{posts.length} fotos/videos</Text>
      </View>

      {isExpired && (
        <View style={styles.expiredBadge}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.expiredText}>Peda terminada</Text>
        </View>
      )}

      {peda?.is_private && peda.invite_code && (
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>Código:</Text>
          <Text style={styles.code}>{peda.invite_code}</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare}>
          <Ionicons name="share-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.gridItem}
            onPress={() => setSelectedPost(item)}
            activeOpacity={0.8}
          >
            <Image
              source={{ uri: item.thumbnail_url || item.media_url }}
              style={styles.gridImage}
            />
            {item.media_type === "video" && (
              <View style={styles.videoIcon}>
                <Ionicons name="play-circle" size={20} color={colors.text} />
              </View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons
              name="camera-outline"
              size={48}
              color={colors.textDimmer}
            />
            <Text style={styles.emptyText}>Aún no hay contenido</Text>
            <Text style={styles.emptySubtext}>
              Sé el primero en subir algo
            </Text>
          </View>
        }
      />

      {isAttendee && !isExpired && (
        <TouchableOpacity
          style={styles.cameraFab}
          onPress={() => router.push(`/camera?pedaId=${id}`)}
          activeOpacity={0.8}
        >
          <Ionicons name="camera" size={28} color={colors.background} />
        </TouchableOpacity>
      )}

      <Modal visible={!!selectedPost} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSafe}>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setSelectedPost(null)}
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>

            {selectedPost?.media_type === "video" ? (
              <VideoPlayer uri={selectedPost.media_url} />
            ) : (
              <Image
                source={{ uri: selectedPost?.media_url }}
                style={styles.fullMedia}
                resizeMode="contain"
              />
            )}

            {selectedPost && (
              <View style={styles.modalActions}>
                <View style={styles.modalActionsLeft}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => toggleLike(selectedPost.id)}
                  >
                    <Ionicons
                      name={
                        selectedPost.liked_by_me
                          ? "heart"
                          : "heart-outline"
                      }
                      size={26}
                      color={
                        selectedPost.liked_by_me
                          ? colors.error
                          : colors.text
                      }
                    />
                    {selectedPost.like_count > 0 && (
                      <Text style={styles.actionCount}>
                        {selectedPost.like_count}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => {
                      const pid = selectedPost.id;
                      setSelectedPost(null);
                      setCommentPostId(pid);
                    }}
                  >
                    <Ionicons
                      name="chatbubble-outline"
                      size={24}
                      color={colors.text}
                    />
                    {selectedPost.comment_count > 0 && (
                      <Text style={styles.actionCount}>
                        {selectedPost.comment_count}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => handleReport(selectedPost.id)}
                >
                  <Ionicons
                    name="flag-outline"
                    size={22}
                    color={colors.textDim}
                  />
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </View>
      </Modal>

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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  headerContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  pedaMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pedaName: {
    fontSize: fonts.title,
    fontWeight: "800",
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  stats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
  },
  expiredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radii.sm,
    alignSelf: "flex-start",
  },
  expiredText: {
    color: colors.textMuted,
    fontSize: fonts.caption,
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.sm,
  },
  codeLabel: { color: colors.textMuted, fontSize: fonts.small },
  code: {
    color: colors.accent,
    fontSize: fonts.body,
    fontWeight: "800",
    letterSpacing: 3,
  },
  gridItem: {
    width: GRID_SIZE,
    height: GRID_SIZE,
    margin: 0.5,
    position: "relative",
  },
  gridImage: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surface,
  },
  videoIcon: {
    position: "absolute",
    bottom: 4,
    right: 4,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  emptySubtext: {
    color: colors.textDimmer,
    fontSize: fonts.small,
  },
  cameraFab: {
    position: "absolute",
    bottom: spacing.xxxl,
    alignSelf: "center",
    backgroundColor: colors.accent,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  modalSafe: { flex: 1 },
  modalClose: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    zIndex: 10,
  },
  fullMedia: {
    flex: 1,
    width: "100%",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  modalActionsLeft: {
    flexDirection: "row",
    gap: spacing.xl,
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
});
