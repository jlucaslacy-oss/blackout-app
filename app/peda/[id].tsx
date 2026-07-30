import { useEffect, useState, useCallback, useRef, memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  Dimensions,
  Alert,
  Modal,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "../../lib/supabase";
import { Peda, Post, Profile } from "../../lib/types";
import { notify } from "../../lib/notifications";
import TimeLeft from "../../components/TimeLeft";
import CommentSheet from "../../components/CommentSheet";
import PinchZoom from "../../components/PinchZoom";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const GRID_SIZE = (width - 3) / 3;
const ICON_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

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

interface PedaPostRowProps {
  item: Post;
  userId: string | null;
  onOpenModal: (post: Post) => void;
  onToggleLike: (postId: string) => void;
  onDoubleTapLike: (postId: string) => void;
  onComment: (postId: string) => void;
  onPressUser: (post: Post) => void;
}

const PedaPostRow = memo(function PedaPostRow({
  item,
  userId,
  onOpenModal,
  onToggleLike,
  onDoubleTapLike,
  onComment,
  onPressUser,
}: PedaPostRowProps) {
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }],
  }));

  const handleDoubleTap = useCallback(() => {
    heartScale.value = 0;
    heartOpacity.value = 1;
    heartScale.value = withSequence(
      withSpring(1.2, { damping: 12, stiffness: 220 }),
      withDelay(150, withTiming(0, { duration: 200 }))
    );
    heartOpacity.value = withDelay(400, withTiming(0, { duration: 150 }));
    onDoubleTapLike(item.id);
  }, [item.id, onDoubleTapLike, heartScale, heartOpacity]);

  const handleSingleTap = useCallback(() => {
    onOpenModal(item);
  }, [item, onOpenModal]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd((_e, success) => {
      if (success) runOnJS(handleDoubleTap)();
    });

  const singleTap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(handleSingleTap)();
  });

  const tapGesture = Gesture.Exclusive(doubleTap, singleTap);

  return (
    <View style={styles.postCard}>
      <TouchableOpacity
        style={styles.postHeader}
        onPress={() => onPressUser(item)}
      >
        <Avatar
          username={item.profiles?.username ?? "?"}
          avatarUrl={item.profiles?.avatar_url}
          size="sm"
        />
        <Text style={styles.postUsername}>
          {item.profiles?.username}
        </Text>
      </TouchableOpacity>
      <GestureDetector gesture={tapGesture}>
        <View>
          {item.media_type === "video" && !item.thumbnail_url ? (
            <View style={[styles.postImage, styles.videoPlaceholder]}>
              <Ionicons name="play-circle" size={48} color={colors.text} />
            </View>
          ) : (
            <Image
              source={{ uri: item.thumbnail_url || item.media_url }}
              style={styles.postImage}
              placeholder={item.blur_data ? { uri: item.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
              placeholderContentFit="cover"
              transition={200}
            />
          )}
          {item.media_type === "video" && item.thumbnail_url && (
            <View style={styles.videoOverlay}>
              <Ionicons name="play-circle" size={40} color={colors.text} />
            </View>
          )}
          <Animated.View pointerEvents="none" style={[styles.heartBurst, heartStyle]}>
            <Ionicons name="heart" size={96} color={colors.text} />
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionBtnInline}
          onPress={() => onToggleLike(item.id)}
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons
            name={item.liked_by_me ? "heart" : "heart-outline"}
            size={22}
            color={item.liked_by_me ? colors.error : colors.text}
          />
          {item.like_count > 0 && (
            <Text style={styles.actionCountInline}>
              {item.like_count}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtnInline}
          onPress={() => onComment(item.id)}
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons
            name="chatbubble-outline"
            size={20}
            color={colors.text}
          />
          {item.comment_count > 0 && (
            <Text style={styles.actionCountInline}>
              {item.comment_count}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {item.caption ? (
        <Text style={styles.postCaption}>
          <Text style={styles.postCaptionUser}>
            {item.profiles?.username}{" "}
          </Text>
          {item.caption}
        </Text>
      ) : null}
    </View>
  );
});

export default function PedaViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [peda, setPeda] = useState<Peda | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAttendee, setIsAttendee] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Profile[]>([]);
  const [attendeesVisible, setAttendeesVisible] = useState(false);
  const swipeY = useSharedValue(0);
  const bgOpacity = useSharedValue(1);
  const likeInFlight = useRef<Set<string>>(new Set());
  const postsRef = useRef<Post[]>([]);
  postsRef.current = posts;

  const openModal = useCallback((post: Post) => {
    setSelectedPost(post);
    setModalVisible(true);
    swipeY.value = 0;
    bgOpacity.value = 1;
  }, [swipeY, bgOpacity]);

  function dismissModal() {
    setModalVisible(false);
    setTimeout(() => {
      setSelectedPost(null);
      swipeY.value = 0;
      bgOpacity.value = 1;
    }, 100);
  }

  const panGesture = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetY([-15, 15])
    .failOffsetX([-10, 10])
    .onUpdate((e) => {
      swipeY.value = e.translationY;
      bgOpacity.value = 1 - Math.min(Math.abs(e.translationY) / 300, 1) * 0.6;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 500) {
        const dir = e.translationY > 0 ? 1 : -1;
        swipeY.value = withTiming(dir * SCREEN_HEIGHT, { duration: 200 });
        bgOpacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(dismissModal)();
        });
      } else {
        swipeY.value = withSpring(0);
        bgOpacity.value = withTiming(1, { duration: 150 });
      }
    });

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: swipeY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const fetchPeda = useCallback(async () => {
    const { data } = await supabase
      .from("pedas")
      .select("*")
      .eq("id", id)
      .single();
    if (data) setPeda(data as Peda);
  }, [id]);

  const fetchPosts = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("posts")
        .select("*, profiles(*)")
        .eq("peda_id", id)
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false });

      if (error || !data) return;

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
    } finally {
      setLoading(false);
    }
  }, [id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchPeda(), fetchPosts()]);
    setRefreshing(false);
  }, [fetchPeda, fetchPosts]);

  async function fetchAttendees() {
    const { data } = await supabase
      .from("peda_attendees")
      .select("profiles:user_id(*)")
      .eq("peda_id", id)
      .order("joined_at", { ascending: true });
    if (data) {
      setAttendees(
        data.map((d: any) => d.profiles).filter(Boolean) as Profile[]
      );
    }
  }

  function showAttendees() {
    fetchAttendees();
    setAttendeesVisible(true);
  }

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

  const applyLikeState = useCallback(
    (postId: string, liked: boolean, delta: number) => {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: liked,
                like_count: Math.max(0, p.like_count + delta),
              }
            : p
        )
      );
      setSelectedPost((prev) =>
        prev && prev.id === postId
          ? {
              ...prev,
              liked_by_me: liked,
              like_count: Math.max(0, prev.like_count + delta),
            }
          : prev
      );
    },
    []
  );

  const toggleLike = useCallback(
    async (postId: string, likeOnly = false) => {
      const post = postsRef.current.find((p) => p.id === postId);
      if (!post) return;
      if (likeOnly && post.liked_by_me) return;
      if (likeInFlight.current.has(postId)) return;
      likeInFlight.current.add(postId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const nextLiked = likeOnly ? true : !post.liked_by_me;
      const delta = nextLiked ? 1 : -1;
      applyLikeState(postId, nextLiked, delta);

      try {
        const { error } = await supabase.rpc("toggle_like", {
          target_post_id: postId,
        });
        if (error) throw error;
        if (nextLiked) notify(post.user_id, "like", { postId });
      } catch {
        applyLikeState(postId, !nextLiked, -delta);
      } finally {
        likeInFlight.current.delete(postId);
      }
    },
    [applyLikeState]
  );

  const handleToggleLike = useCallback(
    (postId: string) => {
      toggleLike(postId);
    },
    [toggleLike]
  );

  const handleDoubleTapLike = useCallback(
    (postId: string) => {
      toggleLike(postId, true);
    },
    [toggleLike]
  );

  const handleComment = useCallback((postId: string) => {
    setCommentPostId(postId);
  }, []);

  const handlePressUser = useCallback(
    (post: Post) => {
      if (post.user_id === userId) {
        router.push("/(tabs)/profile");
      } else {
        router.push(`/user/${post.user_id}`);
      }
    },
    [router, userId]
  );

  async function deletePost(postId: string) {
    Alert.alert("Borrar publicación", "¿Estás seguro? Esto no se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("id", postId);
          if (error) {
            Alert.alert("Error", "No se pudo borrar la publicación. Inténtalo de nuevo.");
            return;
          }
          setPosts((prev) => prev.filter((p) => p.id !== postId));
          dismissModal();
        },
      },
    ]);
  }

  function handlePostMenu(postId: string, postOwnerId: string) {
    const isOwn = postOwnerId === userId;
    if (isOwn) {
      deletePost(postId);
    } else {
      handleReport(postId);
    }
  }

  async function handleReport(postId: string) {
    Alert.alert("Reportar contenido", "¿Por qué quieres reportarlo?", [
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
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: "post",
      target_id: targetId,
      reason,
    });
    if (error) {
      Alert.alert("Error", "No se pudo enviar el reporte. Inténtalo de nuevo.");
      return;
    }
    Alert.alert("Gracias", "Tu reporte fue enviado");
  }

  async function handleShare() {
    if (!peda) return;
    const message =
      peda.is_private && peda.invite_code
        ? `¡Únete a mi peda "${peda.name}" en Blackout! Código: ${peda.invite_code}`
        : `¡Mira esta peda "${peda.name}" en Blackout!`;
    await Share.share({ message });
  }

  async function saveToGallery() {
    if (!selectedPost) return;
    const isVideo = selectedPost.media_type === "video";
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permiso necesario",
        "Necesitamos acceso a tu galería para guardar"
      );
      return;
    }
    try {
      const url = selectedPost.media_url;
      const ext = isVideo ? "mp4" : "jpg";
      const localUri = FileSystem.cacheDirectory + `blackout_${Date.now()}.${ext}`;
      const result = await FileSystem.downloadAsync(url, localUri);
      if (result.status < 200 || result.status >= 300) {
        Alert.alert(
          "Error",
          isVideo
            ? "No se pudo descargar el video. Inténtalo de nuevo."
            : "No se pudo descargar la foto. Inténtalo de nuevo."
        );
        return;
      }
      await MediaLibrary.saveToLibraryAsync(result.uri);
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      Alert.alert(
        "Listo",
        isVideo
          ? "Video guardado en tu galería"
          : "Foto guardada en tu galería"
      );
    } catch {
      Alert.alert(
        "Error",
        isVideo ? "No se pudo guardar el video" : "No se pudo guardar la foto"
      );
    }
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
        <TouchableOpacity
          style={styles.stat}
          onPress={showAttendees}
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons name="people" size={18} color={colors.accent} />
          <Text style={[styles.statText, styles.statLink]}>
            {peda?.attendee_count ?? 0}
          </Text>
        </TouchableOpacity>
        <Text style={styles.statText}>{posts.length} fotos/videos</Text>
      </View>

      {isExpired && (
        <View style={styles.expiredBadge}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.expiredText}>La peda terminó</Text>
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

  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <PedaPostRow
        item={item}
        userId={userId}
        onOpenModal={openModal}
        onToggleLike={handleToggleLike}
        onDoubleTapLike={handleDoubleTapLike}
        onComment={handleComment}
        onPressUser={handlePressUser}
      />
    ),
    [
      userId,
      openModal,
      handleToggleLike,
      handleDoubleTapLike,
      handleComment,
      handlePressUser,
    ]
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={ICON_HIT_SLOP}
          >
            <Ionicons name="chevron-down" size={28} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} hitSlop={ICON_HIT_SLOP}>
            <Ionicons name="share-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={loading ? [] : posts}
          keyExtractor={keyExtractor}
          ListHeaderComponent={renderHeader}
          renderItem={renderPost}
          windowSize={5}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            loading ? null : (
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
            )
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

        <Modal visible={modalVisible} animationType="none" transparent onRequestClose={dismissModal}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Animated.View style={[styles.modalOverlay, overlayStyle]}>
              <SafeAreaView style={styles.modalSafe}>
                {selectedPost && (
                  <View style={styles.modalTopRight}>
                    <TouchableOpacity
                      onPress={saveToGallery}
                      hitSlop={ICON_HIT_SLOP}
                    >
                      <Ionicons name="download-outline" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handlePostMenu(selectedPost.id, selectedPost.user_id)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                )}
                <GestureDetector gesture={panGesture}>
                  <Animated.View style={[{ flex: 1 }, swipeStyle]}>
                {selectedPost?.media_type === "video" ? (
                  <VideoPlayer uri={selectedPost.media_url} />
                ) : (
                  <PinchZoom style={styles.fullMedia}>
                    <Image
                      source={{ uri: selectedPost?.media_url }}
                      style={styles.fullMedia}
                      contentFit="contain"
                      placeholder={selectedPost?.blur_data ? { uri: selectedPost.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
                      placeholderContentFit="contain"
                      transition={300}
                    />
                  </PinchZoom>
                )}

                {selectedPost && (
                  <View style={styles.igBar}>
                    <TouchableOpacity
                      style={styles.igCommentPill}
                      onPress={() => setCommentPostId(selectedPost.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.igCommentPillText}>Comentar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.igHeart}
                      onPress={() => toggleLike(selectedPost.id)}
                      hitSlop={ICON_HIT_SLOP}
                    >
                      <Ionicons
                        name={
                          selectedPost.liked_by_me
                            ? "heart"
                            : "heart-outline"
                        }
                        size={30}
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
                  </View>
                )}
                  </Animated.View>
                </GestureDetector>
              </SafeAreaView>

              <CommentSheet
                postId={commentPostId}
                postOwnerId={posts.find((p) => p.id === commentPostId)?.user_id}
                visible={!!commentPostId && modalVisible}
                onClose={() => setCommentPostId(null)}
                onNavigateAway={dismissModal}
                onCommentDeleted={() => {
                  setPosts((prev) =>
                    prev.map((p) =>
                      p.id === commentPostId
                        ? { ...p, comment_count: Math.max(0, p.comment_count - 1) }
                        : p
                    )
                  );
                  if (selectedPost?.id === commentPostId) {
                    setSelectedPost((prev) =>
                      prev
                        ? { ...prev, comment_count: Math.max(0, prev.comment_count - 1) }
                        : null
                    );
                  }
                }}
                onCommentAdded={() => {
                  setPosts((prev) =>
                    prev.map((p) =>
                      p.id === commentPostId
                        ? { ...p, comment_count: p.comment_count + 1 }
                        : p
                    )
                  );
                  if (selectedPost?.id === commentPostId) {
                    setSelectedPost((prev) =>
                      prev
                        ? { ...prev, comment_count: prev.comment_count + 1 }
                        : null
                    );
                  }
                }}
              />
            </Animated.View>
          </GestureHandlerRootView>
        </Modal>

        <CommentSheet
          postId={commentPostId}
          postOwnerId={posts.find((p) => p.id === commentPostId)?.user_id}
          visible={!!commentPostId && !modalVisible}
          onClose={() => setCommentPostId(null)}
          onCommentDeleted={() => {
            setPosts((prev) =>
              prev.map((p) =>
                p.id === commentPostId
                  ? { ...p, comment_count: Math.max(0, p.comment_count - 1) }
                  : p
              )
            );
          }}
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

        {/* Attendees modal */}
        <Modal visible={attendeesVisible} animationType="slide" transparent onRequestClose={() => setAttendeesVisible(false)}>
          <View style={styles.attendeesOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setAttendeesVisible(false)}
            />
            <View style={styles.attendeesSheet}>
              <View style={styles.attendeesHandle} />
              <Text style={styles.attendeesTitle}>
                Asistentes ({peda?.attendee_count ?? 0})
              </Text>
              <FlatList
                data={attendees}
                keyExtractor={(item) => item.id}
                style={styles.attendeesList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.attendeeRow}
                    onPress={() => {
                      setAttendeesVisible(false);
                      if (item.id === userId) {
                        router.push("/(tabs)/profile");
                      } else {
                        router.push(`/user/${item.id}`);
                      }
                    }}
                  >
                    <Avatar
                      username={item.username}
                      avatarUrl={item.avatar_url}
                      size="sm"
                    />
                    <Text style={styles.attendeeName}>{item.username}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.attendeesEmpty}>Aún no hay asistentes</Text>
                }
              />
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
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
  statLink: {
    color: colors.accent,
    fontWeight: "600",
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
  postCard: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  postUsername: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
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
  igBar: {
    position: "absolute",
    bottom: spacing.xl,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  igCommentPill: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
    justifyContent: "center",
  },
  igCommentPillText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: fonts.body,
  },
  igHeart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 46,
    justifyContent: "center",
  },
  modalTopRight: {
    position: "absolute",
    top: spacing.md,
    right: spacing.lg,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.sm,
  },
  postCaption: {
    color: colors.text,
    fontSize: fonts.body,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    lineHeight: 20,
  },
  postCaptionUser: {
    fontWeight: "700",
  },
  actionBtnInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  actionCountInline: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
  },
  videoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  videoPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  heartBurst: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
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
  modalActionsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
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
  attendeesOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  attendeesSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: 40,
  },
  attendeesHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
    alignSelf: "center",
    marginTop: spacing.md,
  },
  attendeesTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  attendeesList: {
    paddingHorizontal: spacing.xl,
  },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  attendeeName: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  attendeesEmpty: {
    color: colors.textMuted,
    fontSize: fonts.small,
    textAlign: "center",
    paddingVertical: spacing.xxl,
  },
});
