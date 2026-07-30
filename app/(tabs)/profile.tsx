import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput,
  Alert,
  FlatList,
  Dimensions,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { decode } from "base64-arraybuffer";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, withRepeat, runOnJS } from "react-native-reanimated";
import { supabase } from "../../lib/supabase";
import { Profile, Post, FollowStatus } from "../../lib/types";
import Avatar from "../../components/Avatar";
import CommentSheet from "../../components/CommentSheet";
import PinchZoom from "../../components/PinchZoom";
import Button from "../../components/Button";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const GRID_GAP = 1;
const GRID_SIZE = (width - GRID_GAP * 2) / 3;
const USERNAME_MAX = 20;
const USERNAME_REGEX = /^[a-zA-Z0-9._]+$/;

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

function VideoPlayer({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    if (active) p.play();
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return (
    <VideoView
      style={styles.fullMedia}
      player={player}
      nativeControls
    />
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [pagerLocked, setPagerLocked] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followListVisible, setFollowListVisible] = useState(false);
  const [followListTitle, setFollowListTitle] = useState("");
  const [followListUsers, setFollowListUsers] = useState<Profile[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  const swipeY = useSharedValue(0);
  const bgOpacity = useSharedValue(1);

  function openModal(post: Post, index: number) {
    setSelectedPost(post);
    setSelectedIndex(index);
    setModalVisible(true);
    swipeY.value = 0;
    bgOpacity.value = 1;
  }

  function dismissModal() {
    setModalVisible(false);
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

  const fetchProfile = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (data) {
      const p = data as Profile;
      setProfile(p);
      setUsername(p.username);
      setBio(p.bio ?? "");
    }
  }, []);

  const fetchPosts = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("posts")
      .select("*, profiles(*), pedas:peda_id(is_private, expires_at)")
      .eq("user_id", user.id)
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
      const postIds = visible.map((p: any) => p.id);
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
        visible.map((p: any) => ({
          ...p,
          liked_by_me: likedSet.has(p.id),
        })) as Post[]
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      Promise.all([fetchProfile(), fetchPosts()]).finally(() =>
        setLoading(false)
      );
    }, [fetchProfile, fetchPosts])
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([fetchProfile(), fetchPosts()]);
    setRefreshing(false);
  }

  async function pickAndUploadAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setUploadingAvatar(false);
        return;
      }

      const uri = result.assets[0].uri;
      const fileName = `${user.id}/avatar.jpg`;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, decode(base64), {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        Alert.alert("Error", uploadError.message);
        setUploadingAvatar(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(fileName);

      const avatarUrl = `${publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id);

      if (updateError) {
        Alert.alert("Error", updateError.message);
      } else {
        fetchProfile();
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
    setUploadingAvatar(false);
  }

  function validateUsername(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "El nombre de usuario no puede estar vacío";
    if (trimmed.length > USERNAME_MAX)
      return `Máximo ${USERNAME_MAX} caracteres`;
    if (!USERNAME_REGEX.test(trimmed))
      return "Solo letras, números, puntos y guiones bajos";
    return null;
  }

  function onChangeUsername(value: string) {
    setUsername(value);
    setUsernameError(value.trim() ? validateUsername(value) : null);
  }

  async function saveProfile() {
    const validationError = validateUsername(username);
    if (validationError) {
      setUsernameError(validationError);
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ username: username.trim(), bio: bio.trim() || null })
      .eq("id", user.id);

    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        setUsernameError("Ese nombre de usuario ya está ocupado");
      } else {
        Alert.alert("Error", "No se pudo guardar. Intenta de nuevo.");
      }
    } else {
      setEditing(false);
      setUsernameError(null);
      fetchProfile();
    }
  }

  async function signOut() {
    setSettingsVisible(false);
    await supabase.auth.signOut();
  }

  async function deleteAccount() {
    setSettingsVisible(false);
    Alert.alert(
      "Eliminar cuenta",
      "¿Seguro? Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("delete_user_account");
            if (error) {
              Alert.alert("Error", error.message);
              return;
            }
            await supabase.auth.signOut();
          },
        },
      ]
    );
  }

  function showPostMenu(postId: string) {
    Alert.alert("Opciones", "", [
      {
        text: "Eliminar post",
        style: "destructive",
        onPress: () => deletePost(postId),
      },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function deletePost(postId: string) {
    Alert.alert("Eliminar post", "¿Seguro? Esto no se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          // Optimistic removal with rollback if the delete fails
          const prevPosts = posts;
          setPosts((prev) => prev.filter((p) => p.id !== postId));
          setModalVisible(false);
          setSelectedPost(null);
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("id", postId);
          if (error) {
            setPosts(prevPosts);
            Alert.alert("Error", "No se pudo eliminar el post. Intenta de nuevo.");
          }
        },
      },
    ]);
  }

  function applyLike(postId: string, liked: boolean, delta: number) {
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
  }

  const likeInFlight = useRef<Set<string>>(new Set());
  async function toggleLike(post: Post) {
    if (likeInFlight.current.has(post.id)) return;
    likeInFlight.current.add(post.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasLiked = !!post.liked_by_me;
    // Optimistic flip
    applyLike(post.id, !wasLiked, wasLiked ? -1 : 1);
    try {
      const { data, error } = await supabase.rpc("toggle_like", {
        target_post_id: post.id,
      });
      if (error) {
        // Roll back
        applyLike(post.id, wasLiked, wasLiked ? 1 : -1);
        return;
      }
      const liked = data as boolean;
      if (liked !== !wasLiked) {
        // Reconcile with the server result
        applyLike(post.id, liked, liked ? 1 : -1);
      }
    } finally {
      likeInFlight.current.delete(post.id);
    }
  }

  async function openFollowList(kind: "followers" | "following") {
    if (!profile) return;
    setFollowListTitle(kind === "followers" ? "Seguidores" : "Siguiendo");
    setFollowListUsers([]);
    setFollowListLoading(true);
    setFollowListVisible(true);
    const { data } =
      kind === "followers"
        ? await supabase
            .from("follows")
            .select("follower_id, profiles:follower_id(*)")
            .eq("following_id", profile.id)
            .eq("status", "accepted")
        : await supabase
            .from("follows")
            .select("following_id, profiles:following_id(*)")
            .eq("follower_id", profile.id)
            .eq("status", "accepted");
    setFollowListUsers(
      ((data ?? []) as any[]).map((f: any) => f.profiles).filter(Boolean) as Profile[]
    );
    setFollowListLoading(false);
  }

  const renderHeader = () => (
    <View>
      <View style={styles.profileHeader}>
        <TouchableOpacity onPress={pickAndUploadAvatar} activeOpacity={0.7}>
          <Avatar
            username={profile?.username ?? "?"}
            avatarUrl={profile?.avatar_url}
            size="lg"
          />
          <View style={styles.avatarCameraBadge}>
            {uploadingAvatar ? (
              <ActivityIndicator size={12} color={colors.background} />
            ) : (
              <Ionicons name="camera" size={12} color={colors.background} />
            )}
          </View>
        </TouchableOpacity>
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

      {editing ? (
        <View style={styles.editSection}>
          <TextInput
            style={[styles.editInput, usernameError ? styles.editInputError : null]}
            value={username}
            onChangeText={onChangeUsername}
            placeholder="Nombre de usuario"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={USERNAME_MAX}
          />
          {usernameError ? (
            <Text style={styles.inputError}>{usernameError}</Text>
          ) : null}
          <TextInput
            style={[styles.editInput, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Bio (opcional)"
            placeholderTextColor={colors.textDim}
            multiline
          />
          <View style={styles.editButtons}>
            <Button
              title="Guardar"
              onPress={saveProfile}
              loading={saving}
              style={styles.editBtn}
            />
            <Button
              title="Cancelar"
              variant="outline"
              onPress={() => {
                setEditing(false);
                setUsername(profile?.username ?? "");
                setBio(profile?.bio ?? "");
                setUsernameError(null);
              }}
              style={styles.editBtn}
            />
          </View>
        </View>
      ) : (
        <View style={styles.infoSection}>
          <Text style={styles.username}>{profile?.username}</Text>
          {profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}
          <View style={styles.editRow}>
            <Button
              title="Editar perfil"
              variant="outline"
              onPress={() => setEditing(true)}
              style={styles.editProfileBtn}
            />
            <TouchableOpacity
              style={styles.gearBtn}
              onPress={() => setSettingsVisible(true)}
            >
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {posts.length > 0 && (
        <Text style={styles.gridTitle}>Todas tus fotos</Text>
      )}
    </View>
  );

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 88 }}
        columnWrapperStyle={styles.gridRow}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={renderHeader()}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.gridItem}
            onPress={() => openModal(item, index)}
            activeOpacity={0.8}
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
            {item.peda_id && (
              <View style={styles.pedaBadge}>
                <Ionicons name="flame" size={10} color={colors.text} />
              </View>
            )}
          </TouchableOpacity>
        )}
      />

      {/* Photo fullscreen modal */}
      <Modal visible={modalVisible} animationType="fade" transparent onRequestClose={dismissModal}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Animated.View style={[styles.modalOverlay, overlayStyle]}>
            <SafeAreaView style={styles.modalSafe}>
              {selectedPost && (
                <TouchableOpacity
                  style={styles.modalMenuTop}
                  onPress={() => showPostMenu(selectedPost.id)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                </TouchableOpacity>
              )}
              <GestureDetector gesture={panGesture}>
                <Animated.View style={[{ flex: 1 }, swipeStyle]}>
              <FlatList
                data={posts}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                scrollEnabled={!pagerLocked}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={selectedIndex}
                getItemLayout={(_, index) => ({
                  length: width,
                  offset: width * index,
                  index,
                })}
                onMomentumScrollEnd={(e) => {
                  const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
                  setSelectedIndex(newIndex);
                  setSelectedPost(posts[newIndex]);
                }}
                renderItem={({ item, index }) => (
                  <View style={{ width, flex: 1 }}>
                    {item.media_type === "video" ? (
                      <VideoPlayer
                        uri={item.media_url}
                        active={modalVisible && index === selectedIndex}
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
                style={styles.mediaContainer}
              />

              {selectedPost && (
                <View style={styles.viewerFooter}>
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
                      onPress={() => toggleLike(selectedPost)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name={selectedPost.liked_by_me ? "heart" : "heart-outline"}
                        size={30}
                        color={selectedPost.liked_by_me ? colors.error : colors.text}
                      />
                      {selectedPost.like_count > 0 && (
                        <Text style={styles.actionCount}>
                          {selectedPost.like_count}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {posts.length > 1 && (
                    <Text style={styles.modalCounter}>
                      {selectedIndex + 1} / {posts.length}
                    </Text>
                  )}
                </View>
              )}
                </Animated.View>
              </GestureDetector>
            </SafeAreaView>

            <CommentSheet
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
              postId={commentPostId}
              postOwnerId={profile?.id}
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

      {/* Followers/Following modal */}
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
                      if (item.id === profile?.id) return;
                      router.push(`/user/${item.id}`);
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

      {/* Settings modal */}
      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setSettingsVisible(false)}
        >
          <View
            style={[
              styles.settingsSheet,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
          >
            <View style={styles.settingsHandle} />
            <Text style={styles.settingsTitle}>Configuración</Text>

            <TouchableOpacity style={styles.settingsRow} onPress={signOut}>
              <Ionicons
                name="log-out-outline"
                size={22}
                color={colors.accent}
              />
              <Text style={styles.settingsText}>Cerrar sesión</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => {
                setSettingsVisible(false);
                router.push("/privacy");
              }}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color={colors.textSecondary}
              />
              <Text style={styles.settingsText}>Privacidad</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => {
                setSettingsVisible(false);
                router.push("/terms");
              }}
            >
              <Ionicons
                name="document-text-outline"
                size={22}
                color={colors.textSecondary}
              />
              <Text style={styles.settingsText}>Términos de uso</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={deleteAccount}
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.settingsText, styles.dangerText]}>
                Eliminar cuenta
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    padding: spacing.xl,
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: colors.accent,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.background,
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
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  editProfileBtn: {
    flex: 1,
    paddingVertical: 8,
    minHeight: 36,
  },
  gearBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  editSection: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  editInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: fonts.body,
  },
  bioInput: { height: 80, textAlignVertical: "top" },
  editInputError: {
    borderColor: colors.error,
  },
  inputError: {
    color: colors.error,
    fontSize: fonts.caption,
    marginTop: -2,
  },
  editButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  editBtn: { flex: 1 },
  gridTitle: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
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
  pedaBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 8,
    padding: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  modalSafe: { flex: 1, paddingTop: 10 },
  viewerFooter: {
    position: "absolute",
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: "center",
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
  modalMenuTop: {
    position: "absolute",
    top: spacing.md,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  modalCounter: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  menuBtn: {
    justifyContent: "center",
  },
  mediaContainer: {
    flex: 1,
  },
  fullMedia: {
    flex: 1,
    width: "100%",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
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
  settingsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  settingsSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.xl,
  },
  settingsHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
    alignSelf: "center",
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  settingsTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
  },
  settingsText: {
    color: colors.text,
    fontSize: fonts.small,
    flex: 1,
  },
  dangerText: { color: colors.error },
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
});
