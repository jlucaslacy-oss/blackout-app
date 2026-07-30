import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Alert,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  runOnJS,
} from "react-native-reanimated";
import { supabase } from "../../lib/supabase";
import { Profile, Post, FollowStatus } from "../../lib/types";
import { notify } from "../../lib/notifications";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import CommentSheet from "../../components/CommentSheet";
import PinchZoom from "../../components/PinchZoom";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const GRID_GAP = 1;
const GRID_SIZE = (width - GRID_GAP * 2) / 3;
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

function SkeletonPulse({ style }: { style?: object | object[] }) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ backgroundColor: colors.surface }, style, animStyle]}
    />
  );
}

function ViewerVideoPlayer({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    if (active) p.play();
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return <VideoView style={styles.fullMedia} player={player} nativeControls />;
}

export default function UserProfileScreen() {
  const { id: targetUserId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [followStatus, setFollowStatus] = useState<FollowStatus | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [followListVisible, setFollowListVisible] = useState(false);
  const [followListTitle, setFollowListTitle] = useState("");
  const [followListUsers, setFollowListUsers] = useState<Profile[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [pagerLocked, setPagerLocked] = useState(false);
  const likeInFlight = useRef<Set<string>>(new Set());
  const swipeY = useSharedValue(0);
  const bgOpacity = useSharedValue(1);

  const fetchProfile = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", targetUserId)
      .single();
    if (data) setProfile(data as Profile);
  }, [targetUserId]);

  const fetchFollowStatus = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);

    const { data: myProfile } = await supabase
      .from("profiles")
      .select("blocked_users")
      .eq("id", user.id)
      .single();
    if (myProfile) {
      setIsBlocked(
        (myProfile.blocked_users as string[])?.includes(targetUserId) ?? false
      );
    }

    const { data } = await supabase
      .from("follows")
      .select("status")
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId)
      .maybeSingle();

    setFollowStatus(data ? (data.status as FollowStatus) : null);
  }, [targetUserId]);

  const fetchPosts = useCallback(async () => {
    const { data } = await supabase
      .from("posts")
      .select("*, profiles(*), pedas:peda_id(is_private, expires_at)")
      .eq("user_id", targetUserId)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false });
    if (data) {
      const now = new Date().toISOString();
      const visible = data.filter((p: any) => {
        if (!p.peda_id) return true;
        if (p.pedas?.is_private) return false;
        if (p.pedas?.expires_at && p.pedas.expires_at < now) return false;
        return true;
      });
      let likedIds = new Set<string>();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && visible.length > 0) {
        const { data: likes } = await supabase
          .from("likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", visible.map((p: any) => p.id));
        likedIds = new Set((likes ?? []).map((l: any) => l.post_id));
      }
      setPosts(
        visible.map((p: any) => ({ ...p, liked_by_me: likedIds.has(p.id) })) as Post[]
      );
    }
  }, [targetUserId]);

  useEffect(() => {
    Promise.all([fetchProfile(), fetchFollowStatus(), fetchPosts()]).finally(
      () => setInitialLoading(false)
    );
  }, [fetchProfile, fetchFollowStatus, fetchPosts]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([fetchProfile(), fetchFollowStatus(), fetchPosts()]);
    setRefreshing(false);
  }

  const toggleLike = useCallback(
    async (postId: string) => {
      const post = posts.find((p) => p.id === postId);
      if (!post || likeInFlight.current.has(postId)) return;
      likeInFlight.current.add(postId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const nextLiked = !post.liked_by_me;
      const delta = nextLiked ? 1 : -1;
      const apply = (liked: boolean, d: number) =>
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  liked_by_me: liked,
                  like_count: Math.max(0, p.like_count + d),
                }
              : p
          )
        );
      apply(nextLiked, delta);

      try {
        const { error } = await supabase.rpc("toggle_like", {
          target_post_id: postId,
        });
        if (error) throw error;
        if (nextLiked) notify(post.user_id, "like", { postId });
      } catch {
        apply(!nextLiked, -delta);
      } finally {
        likeInFlight.current.delete(postId);
      }
    },
    [posts]
  );

  async function requestFollow() {
    if (!myId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prevStatus = followStatus;
    // Optimistic: accounts are request-based, so the follow lands as pending
    setFollowStatus("pending");
    const { error } = await supabase.from("follows").insert({
      follower_id: myId,
      following_id: targetUserId,
    });
    if (error) {
      setFollowStatus(prevStatus);
      Alert.alert("Error", "No se pudo enviar la solicitud. Intenta de nuevo.");
      return;
    }
    // If the DB auto-accepted (public account), reflect it and bump the count
    const { data: row } = await supabase
      .from("follows")
      .select("status")
      .eq("follower_id", myId)
      .eq("following_id", targetUserId)
      .maybeSingle();
    if (row?.status === "accepted") {
      setFollowStatus("accepted");
      setProfile((prev) =>
        prev ? { ...prev, follower_count: prev.follower_count + 1 } : null
      );
    }
    notify(targetUserId, "follow_request");
  }

  async function unfollow() {
    if (!myId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prevStatus = followStatus;
    const wasAccepted = prevStatus === "accepted";
    setFollowStatus(null);
    if (wasAccepted) {
      setProfile((prev) =>
        prev
          ? { ...prev, follower_count: Math.max(0, prev.follower_count - 1) }
          : null
      );
    }
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", myId)
      .eq("following_id", targetUserId);
    if (error) {
      setFollowStatus(prevStatus);
      if (wasAccepted) {
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count + 1 } : null
        );
      }
      Alert.alert("Error", "No se pudo completar. Intenta de nuevo.");
    }
  }

  async function blockUser() {
    if (!myId) return;
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("blocked_users")
      .eq("id", myId)
      .single();
    if (!myProfile) return;

    const current = (myProfile.blocked_users as string[]) ?? [];
    if (current.includes(targetUserId)) return;

    await supabase
      .from("profiles")
      .update({ blocked_users: [...current, targetUserId] })
      .eq("id", myId);

    if (followStatus === "accepted" || followStatus === "pending") {
      await supabase
        .from("follows")
        .delete()
        .eq("follower_id", myId)
        .eq("following_id", targetUserId);
    }
    await supabase
      .from("follows")
      .delete()
      .eq("follower_id", targetUserId)
      .eq("following_id", myId);

    setIsBlocked(true);
    setFollowStatus(null);
    Alert.alert("Bloqueado", `Bloqueaste a ${profile?.username}`);
  }

  async function unblockUser() {
    if (!myId) return;
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("blocked_users")
      .eq("id", myId)
      .single();
    if (!myProfile) return;

    const current = (myProfile.blocked_users as string[]) ?? [];
    await supabase
      .from("profiles")
      .update({
        blocked_users: current.filter((id: string) => id !== targetUserId),
      })
      .eq("id", myId);

    setIsBlocked(false);
    Alert.alert("Desbloqueado", `Desbloqueaste a ${profile?.username}`);
  }

  async function reportUser() {
    if (!myId) return;
    Alert.alert("Reportar usuario", "¿Por qué quieres reportar a esta persona?", [
      {
        text: "Contenido inapropiado",
        onPress: () => submitReport("inappropriate"),
      },
      { text: "Spam", onPress: () => submitReport("spam") },
      { text: "Acoso", onPress: () => submitReport("harassment") },
      {
        text: "Menor de edad",
        onPress: () => submitReport("underage"),
      },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function submitReport(reason: string) {
    if (!myId) return;
    await supabase.from("reports").insert({
      reporter_id: myId,
      target_type: "user",
      target_id: targetUserId,
      reason,
    });
    Alert.alert("Gracias", "Recibimos tu reporte");
  }

  function showOptions() {
    if (isBlocked) {
      Alert.alert(profile?.username ?? "Usuario", "", [
        { text: "Desbloquear", onPress: unblockUser },
        {
          text: "Reportar",
          style: "destructive",
          onPress: reportUser,
        },
        { text: "Cancelar", style: "cancel" },
      ]);
    } else {
      Alert.alert(profile?.username ?? "Usuario", "", [
        {
          text: "Bloquear",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "Bloquear usuario",
              `¿Bloquear a ${profile?.username}? No podrá ver tu perfil ni contactarte.`,
              [
                { text: "Cancelar", style: "cancel" },
                {
                  text: "Bloquear",
                  style: "destructive",
                  onPress: blockUser,
                },
              ]
            ),
        },
        {
          text: "Reportar",
          style: "destructive",
          onPress: reportUser,
        },
        { text: "Cancelar", style: "cancel" },
      ]);
    }
  }

  async function openFollowList(kind: "followers" | "following") {
    setFollowListTitle(kind === "followers" ? "Seguidores" : "Siguiendo");
    setFollowListUsers([]);
    setFollowListLoading(true);
    setFollowListVisible(true);
    const { data } =
      kind === "followers"
        ? await supabase
            .from("follows")
            .select("follower_id, profiles:follower_id(*)")
            .eq("following_id", targetUserId)
            .eq("status", "accepted")
        : await supabase
            .from("follows")
            .select("following_id, profiles:following_id(*)")
            .eq("follower_id", targetUserId)
            .eq("status", "accepted");
    setFollowListUsers(
      ((data ?? []) as any[]).map((f: any) => f.profiles).filter(Boolean) as Profile[]
    );
    setFollowListLoading(false);
  }

  // --- Fullscreen viewer (pan-to-dismiss + horizontal paging) ---
  function openViewer(index: number) {
    setViewerIndex(index);
    setViewerVisible(true);
    swipeY.value = 0;
    bgOpacity.value = 1;
  }

  function dismissViewer() {
    setViewerVisible(false);
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
          runOnJS(dismissViewer)();
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

  function getFollowButton() {
    if (isBlocked) {
      return (
        <Button
          title="Bloqueado"
          variant="secondary"
          onPress={() =>
            Alert.alert("Desbloquear", `¿Desbloquear a ${profile?.username}?`, [
              { text: "Cancelar", style: "cancel" },
              { text: "Desbloquear", onPress: unblockUser },
            ])
          }
          style={styles.followBtn}
        />
      );
    }
    if (followStatus === "accepted") {
      return (
        <Button
          title="Siguiendo"
          variant="outline"
          onPress={() =>
            Alert.alert(
              "Dejar de seguir",
              `¿Dejar de seguir a ${profile?.username}?`,
              [
                { text: "Cancelar", style: "cancel" },
                {
                  text: "Dejar de seguir",
                  style: "destructive",
                  onPress: unfollow,
                },
              ]
            )
          }
          style={styles.followBtn}
        />
      );
    }
    if (followStatus === "pending") {
      return (
        <Button
          title="Solicitado"
          variant="secondary"
          onPress={() =>
            Alert.alert("Cancelar solicitud", "¿Cancelar la solicitud para seguir?", [
              { text: "No", style: "cancel" },
              { text: "Sí, cancelar", onPress: unfollow },
            ])
          }
          style={styles.followBtn}
        />
      );
    }
    return (
      <Button title="Seguir" onPress={requestFollow} style={styles.followBtn} />
    );
  }

  const canSeePosts =
    !isBlocked && (followStatus === "accepted" || myId === targetUserId);

  const renderSkeleton = () => (
    <View>
      <View style={styles.profileHeader}>
        <SkeletonPulse style={styles.skeletonAvatar} />
        <View style={styles.statsRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.stat}>
              <SkeletonPulse style={styles.skeletonStatNumber} />
              <SkeletonPulse style={styles.skeletonStatLabel} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.infoSection}>
        <SkeletonPulse style={styles.skeletonUsername} />
        <SkeletonPulse style={styles.skeletonBio} />
      </View>
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonPulse key={i} style={styles.skeletonGridCell} />
        ))}
      </View>
    </View>
  );

  const renderHeader = () => (
    <View>
      <View style={styles.profileHeader}>
        <Avatar
          username={profile?.username ?? "?"}
          avatarUrl={profile?.avatar_url}
          size="lg"
        />
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{posts.length}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <TouchableOpacity
            style={styles.stat}
            onPress={() => openFollowList("followers")}
          >
            <Text style={styles.statNumber}>
              {profile?.follower_count ?? 0}
            </Text>
            <Text style={styles.statLabel}>Seguidores</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stat}
            onPress={() => openFollowList("following")}
          >
            <Text style={styles.statNumber}>
              {profile?.following_count ?? 0}
            </Text>
            <Text style={styles.statLabel}>Siguiendo</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.username}>{profile?.username}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        {myId !== targetUserId && getFollowButton()}
      </View>

      {isBlocked && (
        <View style={styles.privateBanner}>
          <Ionicons name="ban" size={32} color={colors.textDim} />
          <Text style={styles.privateText}>Usuario bloqueado</Text>
          <Text style={styles.privateSubtext}>
            No puedes ver el contenido de este usuario
          </Text>
        </View>
      )}

      {!isBlocked && !canSeePosts && myId !== targetUserId && (
        <View style={styles.privateBanner}>
          <Ionicons name="lock-closed" size={32} color={colors.textDim} />
          <Text style={styles.privateText}>Cuenta privada</Text>
          <Text style={styles.privateSubtext}>
            Sigue a esta persona para ver sus fotos
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={HIT_SLOP}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{profile?.username ?? ""}</Text>
        {!initialLoading && myId !== targetUserId ? (
          <TouchableOpacity onPress={showOptions} hitSlop={HIT_SLOP}>
            <Ionicons
              name="ellipsis-horizontal"
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      {initialLoading ? (
        renderSkeleton()
      ) : (
        <FlatList
          data={canSeePosts ? posts : []}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          ListHeaderComponent={renderHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={styles.gridItem}
              activeOpacity={0.8}
              onPress={() => openViewer(index)}
            >
              {item.media_type === "video" && !item.thumbnail_url ? (
                <View style={[styles.gridImage, styles.videoPlaceholder]}>
                  <Ionicons name="play-circle" size={32} color={colors.text} />
                </View>
              ) : (
                <Image
                  source={{ uri: item.thumbnail_url || item.media_url }}
                  style={styles.gridImage}
                  placeholder={item.blur_data ? { uri: item.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
                  placeholderContentFit="cover"
                  transition={200}
                />
              )}
              {item.media_type === "video" && item.thumbnail_url && (
                <View style={styles.videoIcon}>
                  <Ionicons name="play-circle" size={16} color={colors.text} />
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Fullscreen viewer: pan-down to dismiss, swipe horizontally between posts */}
      <Modal visible={viewerVisible} animationType="fade" transparent onRequestClose={dismissViewer}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Animated.View style={[styles.fullscreenOverlay, overlayStyle]}>
            <SafeAreaView style={styles.fullscreenSafe}>
              <TouchableOpacity
                style={styles.fullscreenClose}
                onPress={dismissViewer}
                hitSlop={HIT_SLOP}
              >
                <Ionicons name="close" size={28} color={colors.text} />
              </TouchableOpacity>
              <GestureDetector gesture={panGesture}>
                <Animated.View style={[{ flex: 1 }, swipeStyle]}>
                  <FlatList
                    data={posts}
                    keyExtractor={(item) => item.id}
                    horizontal
                    pagingEnabled
                    scrollEnabled={!pagerLocked}
                    showsHorizontalScrollIndicator={false}
                    initialScrollIndex={viewerIndex}
                    getItemLayout={(_, index) => ({
                      length: width,
                      offset: width * index,
                      index,
                    })}
                    onMomentumScrollEnd={(e) => {
                      const newIndex = Math.round(
                        e.nativeEvent.contentOffset.x / width
                      );
                      setViewerIndex(newIndex);
                    }}
                    renderItem={({ item, index }) => (
                      <View style={{ width, flex: 1 }}>
                        {item.media_type === "video" ? (
                          <ViewerVideoPlayer
                            uri={item.media_url}
                            active={viewerVisible && index === viewerIndex}
                          />
                        ) : (
                          <PinchZoom style={styles.fullMedia} onZoomChange={setPagerLocked}>
                            <Image
                              source={{ uri: item.media_url }}
                              placeholder={item.blur_data ? { uri: item.blur_data } : { blurhash: "L00000fQfQfQ~qfQfQfQfQfQfQfQ" }}
                              placeholderContentFit="contain"
                              style={styles.fullMedia}
                              contentFit="contain"
                              transition={300}
                            />
                          </PinchZoom>
                        )}
                      </View>
                    )}
                  />
                  <View style={styles.viewerFooter}>
                    {posts[viewerIndex] && (
                      <View style={styles.igBar}>
                        <TouchableOpacity
                          style={styles.igCommentPill}
                          onPress={() =>
                            setCommentPostId(posts[viewerIndex].id)
                          }
                          activeOpacity={0.7}
                        >
                          <Text style={styles.igCommentPillText}>
                            Comentar
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.igHeart}
                          onPress={() => toggleLike(posts[viewerIndex].id)}
                          hitSlop={HIT_SLOP}
                        >
                          <Ionicons
                            name={
                              posts[viewerIndex].liked_by_me
                                ? "heart"
                                : "heart-outline"
                            }
                            size={30}
                            color={
                              posts[viewerIndex].liked_by_me
                                ? colors.error
                                : colors.text
                            }
                          />
                          {posts[viewerIndex].like_count > 0 && (
                            <Text style={styles.viewerActionCount}>
                              {posts[viewerIndex].like_count}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                    {posts.length > 1 && (
                      <Text style={styles.viewerCounter}>
                        {viewerIndex + 1} / {posts.length}
                      </Text>
                    )}
                  </View>
                </Animated.View>
              </GestureDetector>
            </SafeAreaView>

            <CommentSheet
              postId={commentPostId}
              postOwnerId={targetUserId}
              visible={commentPostId !== null}
              onClose={() => setCommentPostId(null)}
              onNavigateAway={dismissViewer}
              onCommentDeleted={() =>
                setPosts((prev) =>
                  prev.map((p) =>
                    p.id === commentPostId
                      ? { ...p, comment_count: Math.max(0, p.comment_count - 1) }
                      : p
                  )
                )
              }
              onCommentAdded={() =>
                setPosts((prev) =>
                  prev.map((p) =>
                    p.id === commentPostId
                      ? { ...p, comment_count: p.comment_count + 1 }
                      : p
                  )
                )
              }
            />
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>

      <Modal visible={followListVisible} animationType="slide" transparent onRequestClose={() => setFollowListVisible(false)}>
        <TouchableOpacity
          style={styles.followListOverlay}
          activeOpacity={1}
          onPress={() => setFollowListVisible(false)}
        >
          <View
            style={[
              styles.followListSheet,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
          >
            <View style={styles.followListHandle} />
            <Text style={styles.followListTitle}>{followListTitle}</Text>
            {followListLoading ? (
              <View style={styles.followListContent}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.followListRow}>
                    <SkeletonPulse style={styles.skeletonRowAvatar} />
                    <SkeletonPulse style={styles.skeletonRowName} />
                  </View>
                ))}
              </View>
            ) : (
              <FlatList
                data={followListUsers}
                keyExtractor={(item) => item.id}
                style={styles.followListContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.followListRow}
                    onPress={() => {
                      setFollowListVisible(false);
                      if (item.id === myId) {
                        router.push("/(tabs)/profile");
                      } else if (item.id !== targetUserId) {
                        router.push(`/user/${item.id}`);
                      }
                    }}
                  >
                    <Avatar
                      username={item.username}
                      avatarUrl={item.avatar_url}
                      size="sm"
                    />
                    <Text style={styles.followListName}>{item.username}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.followListEmpty}>Aún no hay nadie</Text>
                }
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
  topBarTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    padding: spacing.xl,
  },
  statsRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stat: { alignItems: "center" },
  statNumber: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: 2,
  },
  infoSection: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  username: {
    color: colors.text,
    fontSize: fonts.title,
    fontWeight: "700",
  },
  bio: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    marginTop: spacing.xs,
  },
  followBtn: {
    marginTop: spacing.md,
    paddingVertical: 8,
    minHeight: 44,
  },
  privateBanner: {
    alignItems: "center",
    paddingTop: 60,
    gap: spacing.sm,
  },
  privateText: {
    color: colors.textDim,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  privateSubtext: {
    color: colors.textDimmer,
    fontSize: fonts.small,
  },
  gridRow: {
    gap: GRID_GAP,
  },
  gridItem: {
    width: GRID_SIZE,
    height: GRID_SIZE,
    marginBottom: GRID_GAP,
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
  videoPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  // Skeleton
  skeletonAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  skeletonStatNumber: {
    width: 28,
    height: 20,
    borderRadius: radii.sm,
  },
  skeletonStatLabel: {
    width: 48,
    height: 10,
    borderRadius: radii.sm,
    marginTop: 6,
  },
  skeletonUsername: {
    width: 140,
    height: 22,
    borderRadius: radii.sm,
  },
  skeletonBio: {
    width: 200,
    height: 12,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
    marginTop: spacing.lg,
  },
  skeletonGridCell: {
    width: GRID_SIZE,
    height: GRID_SIZE,
  },
  skeletonRowAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  skeletonRowName: {
    width: 120,
    height: 14,
    borderRadius: radii.sm,
  },
  followListOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  followListSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
  },
  followListHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
    alignSelf: "center",
    marginTop: spacing.md,
  },
  followListTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  followListContent: {
    paddingHorizontal: spacing.xl,
  },
  followListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  followListName: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  followListEmpty: {
    color: colors.textMuted,
    fontSize: fonts.small,
    textAlign: "center",
    paddingVertical: spacing.xxl,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  fullscreenSafe: {
    flex: 1,
  },
  fullscreenClose: {
    position: "absolute",
    top: spacing.md,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  fullMedia: {
    flex: 1,
    width: "100%",
  },
  viewerFooter: {
    position: "absolute",
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  viewerCounter: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  igBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    alignSelf: "stretch",
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
  viewerActionCount: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "600",
  },
});
