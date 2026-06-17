import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Profile, Post, FollowStatus } from "../../lib/types";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import { colors, spacing, fonts, radii } from "../../components/theme";

const { width } = Dimensions.get("window");
const GRID_SIZE = (width - 3) / 3;

export default function UserProfileScreen() {
  const { id: targetUserId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [followStatus, setFollowStatus] = useState<FollowStatus | null>(null);
  const [loading, setLoading] = useState(false);

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
      .select("*, profiles(*)")
      .eq("user_id", targetUserId)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false });
    if (data) setPosts(data as Post[]);
  }, [targetUserId]);

  useEffect(() => {
    fetchProfile();
    fetchFollowStatus();
    fetchPosts();
  }, [fetchProfile, fetchFollowStatus, fetchPosts]);

  async function requestFollow() {
    if (!myId) return;
    setLoading(true);
    const { error } = await supabase.from("follows").insert({
      follower_id: myId,
      following_id: targetUserId,
    });
    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setFollowStatus("pending");
  }

  async function unfollow() {
    if (!myId) return;
    setLoading(true);
    await supabase
      .from("follows")
      .delete()
      .eq("follower_id", myId)
      .eq("following_id", targetUserId);
    setLoading(false);
    setFollowStatus(null);
    setProfile((prev) =>
      prev
        ? { ...prev, follower_count: Math.max(0, prev.follower_count - 1) }
        : null
    );
  }

  function getFollowButton() {
    if (followStatus === "accepted") {
      return (
        <Button
          title="Siguiendo"
          variant="outline"
          onPress={() =>
            Alert.alert("Dejar de seguir", `¿Dejar de seguir a ${profile?.username}?`, [
              { text: "Cancelar", style: "cancel" },
              { text: "Dejar de seguir", style: "destructive", onPress: unfollow },
            ])
          }
          loading={loading}
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
            Alert.alert("Cancelar solicitud", "¿Cancelar solicitud de seguimiento?", [
              { text: "No", style: "cancel" },
              { text: "Cancelar", onPress: unfollow },
            ])
          }
          loading={loading}
          style={styles.followBtn}
        />
      );
    }
    return (
      <Button
        title="Seguir"
        onPress={requestFollow}
        loading={loading}
        style={styles.followBtn}
      />
    );
  }

  const canSeePosts = followStatus === "accepted" || myId === targetUserId;

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

      <View style={styles.infoSection}>
        <Text style={styles.username}>{profile?.username}</Text>
        {profile?.bio ? (
          <Text style={styles.bio}>{profile.bio}</Text>
        ) : null}
        {myId !== targetUserId && getFollowButton()}
      </View>

      {!canSeePosts && (
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
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{profile?.username ?? ""}</Text>
        <View style={{ width: 28 }} />
      </View>

      <FlatList
        data={canSeePosts ? posts : []}
        keyExtractor={(item) => item.id}
        numColumns={3}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.gridItem} activeOpacity={0.8}>
            <Image
              source={{ uri: item.thumbnail_url || item.media_url }}
              style={styles.gridImage}
            />
            {item.media_type === "video" && (
              <View style={styles.videoIcon}>
                <Ionicons name="play-circle" size={16} color={colors.text} />
              </View>
            )}
          </TouchableOpacity>
        )}
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
});
