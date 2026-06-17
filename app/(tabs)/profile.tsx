import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
  Image,
  Dimensions,
  Linking,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { supabase } from "../../lib/supabase";
import { Profile, Post } from "../../lib/types";
import Avatar from "../../components/Avatar";
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

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

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
      .select("*, profiles(*)")
      .eq("user_id", user.id)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false });

    if (data) {
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
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      fetchPosts();
    }, [fetchProfile, fetchPosts])
  );

  async function saveProfile() {
    if (!username.trim()) {
      Alert.alert("Error", "El username no puede estar vacío");
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
      Alert.alert("Error", error.message);
    } else {
      setEditing(false);
      fetchProfile();
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function deleteAccount() {
    Alert.alert(
      "Eliminar cuenta",
      "¿Estás seguro? Esta acción no se puede deshacer.",
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
          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {profile?.follower_count ?? 0}
            </Text>
            <Text style={styles.statLabel}>Seguidores</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {profile?.following_count ?? 0}
            </Text>
            <Text style={styles.statLabel}>Siguiendo</Text>
          </View>
        </View>
      </View>

      {editing ? (
        <View style={styles.editSection}>
          <TextInput
            style={styles.editInput}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
          />
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
          <Button
            title="Editar perfil"
            variant="outline"
            onPress={() => setEditing(true)}
            style={styles.editProfileBtn}
          />
        </View>
      )}

      <View style={styles.settingsSection}>
        <TouchableOpacity style={styles.settingsRow} onPress={signOut}>
          <Ionicons name="log-out-outline" size={22} color={colors.accent} />
          <Text style={styles.settingsText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => Linking.openURL("https://lapeda.app/privacy")}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={22}
            color={colors.textSecondary}
          />
          <Text style={styles.settingsText}>Privacidad</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.settingsRow, styles.dangerRow]}
          onPress={deleteAccount}
        >
          <Ionicons name="trash-outline" size={22} color={colors.error} />
          <Text style={[styles.settingsText, styles.dangerText]}>
            Eliminar cuenta
          </Text>
        </TouchableOpacity>
      </View>

      {posts.length > 0 && (
        <Text style={styles.gridTitle}>Todas tus fotos</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
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
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => toggleLike(selectedPost.id)}
                >
                  <Ionicons
                    name={
                      selectedPost.liked_by_me ? "heart" : "heart-outline"
                    }
                    size={26}
                    color={
                      selectedPost.liked_by_me ? colors.error : colors.text
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
                    setSelectedPost(null);
                    setCommentPostId(selectedPost.id);
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
  editProfileBtn: {
    marginTop: spacing.md,
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
  editButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  editBtn: { flex: 1 },
  settingsSection: {
    borderTopWidth: 1,
    borderTopColor: colors.surface,
    marginHorizontal: spacing.xl,
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  settingsText: {
    color: colors.text,
    fontSize: fonts.small,
    flex: 1,
  },
  dangerRow: {},
  dangerText: { color: colors.error },
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
});
