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
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  withRepeat,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { supabase } from "../../lib/supabase";
import { Post, Profile, NearbyPeda } from "../../lib/types";
import { notify } from "../../lib/notifications";
import Avatar from "../../components/Avatar";
import CommentSheet from "../../components/CommentSheet";
import PinchZoom from "../../components/PinchZoom";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const ICON_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

function FeedVideoPlayer({ uri, style, paused }: { uri: string; style: any; paused?: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    if (!paused) p.play();
  });
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  return <VideoView style={style} player={player} nativeControls />;
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

function SkeletonPost() {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.8, { duration: 750 }), -1, true);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.skeletonCard, pulseStyle]}>
      <View style={styles.skeletonHeader}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.skeletonLines}>
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonLineShort} />
        </View>
      </View>
      <View style={styles.skeletonMedia} />
      <View style={styles.skeletonActions}>
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonDot} />
      </View>
    </Animated.View>
  );
}

interface PostRowProps {
  item: Post;
  userId: string | null;
  onOpenModal: (post: Post) => void;
  onToggleLike: (postId: string) => void;
  onDoubleTapLike: (postId: string) => void;
  onComment: (postId: string) => void;
  onDelete: (postId: string) => void;
  onReport: (postId: string) => void;
  onPressUser: (post: Post) => void;
}

const PostRow = memo(function PostRow({
  item,
  userId,
  onOpenModal,
  onToggleLike,
  onDoubleTapLike,
  onComment,
  onDelete,
  onReport,
  onPressUser,
}: PostRowProps) {
  const isOwn = item.user_id === userId;
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
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={styles.postHeaderLeft}
          onPress={() => onPressUser(item)}
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
      </View>

      <GestureDetector gesture={tapGesture}>
        <View>
          {item.media_type === "video" ? (
            <View>
              <Image
                source={{ uri: item.thumbnail_url || item.media_url }}
                style={styles.postImage}
                contentFit="cover"
                placeholder={item.blur_data ? { uri: item.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
                placeholderContentFit="cover"
                transition={200}
              />
              <View style={styles.playOverlay}>
                <Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.85)" />
              </View>
            </View>
          ) : (
            <Image
              source={{ uri: item.media_url }}
              style={styles.postImage}
              contentFit="cover"
              placeholder={item.blur_data ? { uri: item.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
              placeholderContentFit="cover"
              transition={200}
            />
          )}
          <Animated.View pointerEvents="none" style={[styles.heartBurst, heartStyle]}>
            <Ionicons name="heart" size={96} color={colors.text} />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onToggleLike(item.id)}
          hitSlop={ICON_HIT_SLOP}
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
          onPress={() => onComment(item.id)}
          hitSlop={ICON_HIT_SLOP}
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

        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => (isOwn ? onDelete(item.id) : onReport(item.id))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
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
});

function timeLeftLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "terminando";
  const hrs = Math.floor(ms / 3600000);
  if (hrs >= 1) return `termina en ${hrs}h`;
  return `termina en ${Math.max(1, Math.floor(ms / 60000))}min`;
}

function DiscoverEmpty({ myId }: { myId: string | null }) {
  const router = useRouter();
  const [nearbyPedas, setNearbyPedas] = useState<NearbyPeda[]>([]);
  const [suggested, setSuggested] = useState<Profile[]>([]);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Nearby public pedas — independent of auth; only if location was already
  // granted (never prompt from the feed). Runs once per mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { data } = await supabase.rpc("nearby_pedas", {
          user_lat: loc.coords.latitude,
          user_lng: loc.coords.longitude,
          radius_km: 10,
        });
        if (!cancelled && data) {
          setNearbyPedas(
            (data as NearbyPeda[]).filter((pd) => !pd.is_private).slice(0, 3)
          );
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: follows } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", myId);
        const followedIds = new Set(
          (follows ?? []).map((f: any) => f.following_id)
        );
        const { data: profs } = await supabase
          .from("profiles")
          .select("*")
          .neq("id", myId)
          .order("created_at", { ascending: false })
          .limit(25);
        if (!cancelled && profs) {
          setSuggested(
            (profs as Profile[]).filter((pr) => !followedIds.has(pr.id)).slice(0, 8)
          );
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [myId]);

  async function joinPeda(peda: NearbyPeda) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("peda_attendees")
      .upsert({ peda_id: peda.id, user_id: user.id });
    if (error) {
      Alert.alert("Ups", "No pudimos unirte a la peda. Inténtalo de nuevo.");
      return;
    }
    router.push(`/peda/${peda.id}`);
  }

  async function requestFollow(targetId: string) {
    if (!myId || requested.has(targetId)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRequested((prev) => new Set(prev).add(targetId));
    const { error } = await supabase.from("follows").insert({
      follower_id: myId,
      following_id: targetId,
    });
    if (error) {
      setRequested((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      return;
    }
    notify(targetId, "follow_request");
  }

  return (
    <View style={styles.discover}>
      <View style={styles.empty}>
        <Ionicons name="image-outline" size={48} color={colors.textDimmer} />
        <Text style={styles.emptyTitle}>La noche está tranquila… todavía</Text>
        <Text style={styles.emptySubtext}>
          Mientras tanto, mira lo que está pasando
        </Text>
      </View>

      {nearbyPedas.length > 0 && (
        <View style={styles.discoverSection}>
          <Text style={styles.discoverLabel}>PEDAS ACTIVAS CERCA DE TI</Text>
          {nearbyPedas.map((peda) => (
            <View key={peda.id} style={styles.pedaCard}>
              <View style={styles.pedaCardIcon}>
                <Ionicons name="flash" size={20} color={colors.text} />
              </View>
              <View style={styles.pedaCardBody}>
                <Text style={styles.pedaCardName} numberOfLines={1}>
                  {peda.emoji ? `${peda.emoji} ` : ""}
                  {peda.name}
                </Text>
                <Text style={styles.pedaCardMeta} numberOfLines={1}>
                  {peda.distance_km < 1
                    ? `a ${Math.round(peda.distance_km * 1000)}m`
                    : `a ${peda.distance_km.toFixed(1)}km`}
                  {" · "}
                  {peda.attendee_count}{" "}
                  {peda.attendee_count === 1 ? "persona" : "personas"}
                  {" · "}
                  {timeLeftLabel(peda.expires_at)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.discoverPill}
                onPress={() => joinPeda(peda)}
                activeOpacity={0.8}
              >
                <Text style={styles.discoverPillText}>Únete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {suggested.length > 0 && (
        <View style={styles.discoverSection}>
          <Text style={styles.discoverLabel}>A QUIÉN SEGUIR</Text>
          {suggested.map((prof) => {
            const isRequested = requested.has(prof.id);
            return (
              <View key={prof.id} style={styles.suggestRow}>
                <TouchableOpacity
                  onPress={() => router.push(`/user/${prof.id}`)}
                  hitSlop={ICON_HIT_SLOP}
                >
                  <Avatar
                    username={prof.username}
                    avatarUrl={prof.avatar_url}
                    size="md"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestBody}
                  onPress={() => router.push(`/user/${prof.id}`)}
                >
                  <Text style={styles.suggestName} numberOfLines={1}>
                    {prof.username}
                  </Text>
                  <Text style={styles.suggestMeta} numberOfLines={1}>
                    {prof.bio || "Nuevo en Blackout"}
                  </Text>
                </TouchableOpacity>
                {isRequested ? (
                  <View style={styles.discoverPillOutline}>
                    <Text style={styles.discoverPillOutlineText}>
                      Solicitado
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.discoverPill}
                    onPress={() => requestFollow(prof.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.discoverPillText}>Seguir</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[styles.emptyCta, styles.discoverCta]}
        onPress={() => router.push("/camera")}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyCtaText}>Sube algo</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = Math.max(insets.bottom, 16) + 88;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
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

  const reportPost = useCallback((postId: string) => {
    Alert.alert("Reportar publicación", "¿Por qué quieres reportar esta publicación?", [
      { text: "Inapropiado", onPress: () => submitReport(postId, "inappropriate") },
      { text: "Spam", onPress: () => submitReport(postId, "spam") },
      { text: "Acoso", onPress: () => submitReport(postId, "harassment") },
      { text: "Cancelar", style: "cancel" },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const deletePost = useCallback((postId: string) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitReport(postId: string, reason: string) {
    if (!userId) return;
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: "post",
      target_id: postId,
      reason,
    });
    if (error) {
      Alert.alert("Error", "No se pudo enviar el reporte. Inténtalo de nuevo.");
      return;
    }
    Alert.alert("Gracias", "Tu reporte fue enviado");
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const fetchFeed = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("blocked_users")
        .eq("id", user.id)
        .single();
      const blocked = new Set<string>(
        (myProfile?.blocked_users as string[]) ?? []
      );

      const { data, error } = await supabase
        .from("posts")
        .select("*, profiles(*)")
        .is("peda_id", null)
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error || !data) {
        setLoadError(true);
        return;
      }

      const filtered = data.filter((p: any) => !blocked.has(p.user_id));
      const postIds = filtered.map((p: any) => p.id);
      let likedSet = new Set<string>();
      if (postIds.length > 0) {
        const { data: likes } = await supabase
          .from("likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", postIds);
        if (likes) likedSet = new Set(likes.map((l: any) => l.post_id));
      }

      setLoadError(false);
      setPosts(
        filtered.map((p: any) => ({ ...p, liked_by_me: likedSet.has(p.id) })) as Post[]
      );
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const [hasRequests, setHasRequests] = useState(false);
  const fetchPendingRequests = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { count } = await supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("following_id", user.id)
      .eq("status", "pending");
    setHasRequests((count ?? 0) > 0);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      fetchFeed();
      fetchPendingRequests();
      return () => setIsFocused(false);
    }, [fetchFeed, fetchPendingRequests])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  }

  // Tap the Feed tab while already on it -> scroll to top + refresh
  const listRef = useRef<FlatList<Post>>(null);
  const navigation = useNavigation();
  useEffect(() => {
    const unsub = (navigation as any).addListener("tabPress", () => {
      if ((navigation as any).isFocused()) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        onRefreshRef.current();
      }
    });
    return unsub;
  }, [navigation]);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

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

  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <PostRow
        item={item}
        userId={userId}
        onOpenModal={openModal}
        onToggleLike={handleToggleLike}
        onDoubleTapLike={handleDoubleTapLike}
        onComment={handleComment}
        onDelete={deletePost}
        onReport={reportPost}
        onPressUser={handlePressUser}
      />
    ),
    [
      userId,
      openModal,
      handleToggleLike,
      handleDoubleTapLike,
      handleComment,
      deletePost,
      reportPost,
      handlePressUser,
    ]
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.topBar}>
          <View style={styles.logoRow}>
            <Ionicons name="flash" size={20} color={colors.text} />
            <Text style={styles.logoBlack}>BLACK</Text>
            <Text style={styles.logoOut}>OUT</Text>
          </View>
          <View style={styles.topBarRight}>
            <TouchableOpacity
              onPress={() => router.push("/follow-requests")}
              hitSlop={ICON_HIT_SLOP}
            >
              <View>
                <Ionicons
                  name="people-outline"
                  size={24}
                  color={colors.text}
                />
                {hasRequests && <View style={styles.requestsDot} />}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/camera")}
              hitSlop={ICON_HIT_SLOP}
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
          ref={listRef}
          data={loading ? [] : posts}
          keyExtractor={keyExtractor}
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
            loading ? (
              <View>
                <SkeletonPost />
                <SkeletonPost />
                <SkeletonPost />
              </View>
            ) : loadError ? (
              <Pressable
                style={styles.empty}
                onPress={() => {
                  setLoading(true);
                  fetchFeed();
                }}
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={48}
                  color={colors.textDimmer}
                />
                <Text style={styles.emptyTitle}>No se pudo cargar</Text>
                <Text style={styles.emptySubtext}>Toca para reintentar</Text>
              </Pressable>
            ) : (
              <DiscoverEmpty myId={userId} />
            )
          }
          contentContainerStyle={
            posts.length === 0 && !loading
              ? styles.emptyList
              : { paddingBottom: tabBarClearance }
          }
        />

        <Modal visible={modalVisible} animationType="none" transparent onRequestClose={dismissModal}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Animated.View style={[styles.modalOverlay, overlayStyle]}>
              <SafeAreaView style={styles.modalSafe}>
                {selectedPost && (
                  <TouchableOpacity
                    style={styles.modalMenuTop}
                    onPress={() => {
                      const isOwn = selectedPost.user_id === userId;
                      if (isOwn) deletePost(selectedPost.id);
                      else reportPost(selectedPost.id);
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                  </TouchableOpacity>
                )}
                <GestureDetector gesture={panGesture}>
                  <Animated.View style={[styles.modalSwipeable, swipeStyle]}>
                <View style={styles.modalMediaContainer}>
                  {selectedPost?.media_type === "video" ? (
                    <FeedVideoPlayer uri={selectedPost.media_url} style={styles.modalMedia} paused={!modalVisible} />
                  ) : (
                    <PinchZoom style={styles.modalMedia}>
                      <Image
                        source={{ uri: selectedPost?.media_url }}
                        placeholder={selectedPost?.blur_data ? { uri: selectedPost.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
                        placeholderContentFit="contain"
                        style={styles.modalMedia}
                        contentFit="contain"
                        transition={300}
                      />
                    </PinchZoom>
                  )}
                </View>

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
                        name={selectedPost.liked_by_me ? "heart" : "heart-outline"}
                        size={30}
                        color={selectedPost.liked_by_me ? colors.error : colors.text}
                      />
                      {selectedPost.like_count > 0 && (
                        <Text style={styles.actionCount}>{selectedPost.like_count}</Text>
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
                        : prev
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
                        : prev
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
            if (selectedPost?.id === commentPostId) {
              setSelectedPost((prev) =>
                prev ? { ...prev, comment_count: prev.comment_count + 1 } : null
              );
            }
          }}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
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
    justifyContent: "space-between",
    padding: spacing.md,
  },
  postHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
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
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  menuBtn: {
    marginLeft: "auto",
    justifyContent: "center",
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
    paddingTop: 48,
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySubtext: {
    color: colors.textDimmer,
    fontSize: fonts.small,
    textAlign: "center",
  },
  emptyCta: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    minHeight: 44,
    justifyContent: "center",
  },
  emptyCtaText: {
    color: colors.background,
    fontSize: fonts.small,
    fontWeight: "800",
    letterSpacing: 1,
  },
  discover: {
    paddingBottom: spacing.xxl,
  },
  discoverSection: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  discoverLabel: {
    color: colors.textDim,
    fontSize: fonts.caption,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: spacing.md,
    marginLeft: 4,
  },
  pedaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceLight,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pedaCardIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  pedaCardBody: {
    flex: 1,
    minWidth: 0,
  },
  pedaCardName: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  pedaCardMeta: {
    color: colors.textDim,
    fontSize: fonts.small,
    marginTop: 2,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestBody: {
    flex: 1,
    minWidth: 0,
  },
  suggestName: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  suggestMeta: {
    color: colors.textDimmer,
    fontSize: fonts.small,
    marginTop: 2,
  },
  discoverPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radii.full,
    minHeight: 36,
    justifyContent: "center",
  },
  discoverPillText: {
    color: colors.background,
    fontSize: fonts.small,
    fontWeight: "800",
  },
  discoverPillOutline: {
    borderWidth: 1,
    borderColor: colors.surfaceLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    minHeight: 36,
    justifyContent: "center",
  },
  discoverPillOutlineText: {
    color: colors.textDim,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  discoverCta: {
    alignSelf: "center",
    marginTop: spacing.xxl,
  },
  requestsDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.background,
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
  modalMenuTop: {
    position: "absolute",
    top: spacing.md,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  emptyList: {
    flexGrow: 1,
  },
  skeletonCard: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    paddingBottom: spacing.md,
  },
  skeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  skeletonAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  skeletonLines: {
    gap: spacing.xs,
  },
  skeletonLine: {
    width: 120,
    height: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  skeletonLineShort: {
    width: 60,
    height: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  skeletonMedia: {
    width,
    height: width,
    backgroundColor: colors.surface,
  },
  skeletonActions: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  skeletonDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  modalSafe: { flex: 1 },
  modalSwipeable: { flex: 1 },
  modalMediaContainer: {
    flex: 1,
  },
  modalMedia: {
    flex: 1,
    width: "100%",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
});
