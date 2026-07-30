import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { Comment, Profile } from "../lib/types";
import { notify } from "../lib/notifications";
import Avatar from "./Avatar";
import { colors, spacing, fonts, radii } from "./theme";

const SHEET_HEIGHT = Dimensions.get("window").height * 0.6;

interface Props {
  postId: string | null;
  postOwnerId?: string | null;
  visible: boolean;
  onClose: () => void;
  onCommentAdded?: () => void;
  onCommentDeleted?: () => void;
  // Called before navigating to a profile so the parent can also close any
  // fullscreen viewer Modal (otherwise the pushed screen renders behind it).
  onNavigateAway?: () => void;
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

export default function CommentSheet({
  postId,
  postOwnerId,
  visible,
  onClose,
  onCommentAdded,
  onCommentDeleted,
  onNavigateAway,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const listRef = useRef<FlatList<Comment>>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const goToProfile = useCallback(
    (commentUserId: string) => {
      onClose();
      onNavigateAway?.();
      if (commentUserId === userId) {
        router.push("/(tabs)/profile");
      } else {
        router.push(`/user/${commentUserId}`);
      }
    },
    [onClose, onNavigateAway, router, userId]
  );

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (data) setMyProfile(data as Profile);
      }
    });
  }, []);

  const fetchComments = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from("comments")
      .select("*, profiles:user_id(*)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (data) setComments(data as Comment[]);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    if (visible && postId) {
      setLoading(true);
      fetchComments();
    }
    if (!visible) {
      setComments([]);
      setText("");
      setSendError(false);
      setLoading(true);
    }
  }, [visible, postId, fetchComments]);

  async function sendComment() {
    if (!text.trim() || !postId || sending) return;
    const sentText = text.trim();
    setSending(true);
    setSendError(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSending(false);
      setSendError(true);
      return;
    }

    // Optimistic append so the user sees their comment instantly
    const tempId = `temp-${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      user_id: user.id,
      post_id: postId,
      text: sentText,
      created_at: new Date().toISOString(),
      profiles: myProfile ?? undefined,
    };
    setComments((prev) => [...prev, optimistic]);
    setText("");
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });

    const { error } = await supabase.from("comments").insert({
      user_id: user.id,
      post_id: postId,
      text: sentText,
    });
    setSending(false);

    if (error) {
      // Roll back the optimistic comment and keep the draft
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setText(sentText);
      setSendError(true);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCommentAdded?.();
    fetchComments();
    if (postOwnerId) {
      notify(postOwnerId, "comment", { postId: postId!, commentText: sentText });
    }
  }

  function handleCommentMenu(comment: Comment) {
    const isCommentOwner = comment.user_id === userId;
    const isPostOwner = postOwnerId === userId;
    const canDelete = isCommentOwner || isPostOwner;

    if (canDelete) {
      Alert.alert("Comentario", undefined, [
        {
          text: "Borrar",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("comments")
              .delete()
              .eq("id", comment.id);
            if (!error) onCommentDeleted?.();
            fetchComments();
          },
        },
        ...(!isCommentOwner
          ? [
              {
                text: "Reportar",
                onPress: () => reportComment(comment.id),
              },
            ]
          : []),
        { text: "Cancelar", style: "cancel" as const },
      ]);
    } else {
      Alert.alert("Reportar comentario", "¿Por qué quieres reportarlo?", [
        { text: "Inapropiado", onPress: () => reportComment(comment.id) },
        { text: "Spam", onPress: () => reportComment(comment.id) },
        { text: "Cancelar", style: "cancel" },
      ]);
    }
  }

  async function reportComment(commentId: string) {
    if (!userId) return;
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: "comment",
      target_id: commentId,
      reason: "inappropriate",
    });
    if (error) {
      Alert.alert("Error", "No se pudo enviar el reporte. Inténtalo de nuevo.");
      return;
    }
    Alert.alert("Gracias", "Tu reporte fue enviado");
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Comentarios</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.commentRow}>
                <TouchableOpacity
                  onPress={() => goToProfile(item.user_id)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Avatar
                    username={item.profiles?.username ?? "?"}
                    avatarUrl={item.profiles?.avatar_url}
                    size="sm"
                  />
                </TouchableOpacity>
                <View style={styles.commentBody}>
                  <View style={styles.commentHeader}>
                    <Text
                      style={styles.commentUser}
                      onPress={() => goToProfile(item.user_id)}
                    >
                      {item.profiles?.username}
                    </Text>
                    <Text style={styles.commentTime}>
                      {timeAgo(item.created_at)}
                    </Text>
                  </View>
                  <Text style={styles.commentText}>{item.text}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleCommentMenu(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.commentMenuBtn}
                >
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator
                  color={colors.textMuted}
                  style={styles.loadingSpinner}
                />
              ) : (
                <Text style={styles.empty}>Aún no hay comentarios</Text>
              )
            }
          />

          {sendError && (
            <Text style={styles.sendError}>
              No se pudo enviar. Inténtalo de nuevo
            </Text>
          )}

          <View
            style={[
              styles.inputRow,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (sendError) setSendError(false);
              }}
              placeholder="Escribe un comentario..."
              placeholderTextColor={colors.textDim}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              onPress={sendComment}
              disabled={!text.trim() || sending}
              style={[
                styles.sendBtn,
                (!text.trim() || sending) && styles.sendBtnDisabled,
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Ionicons name="send" size={20} color={colors.background} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
    minHeight: 90,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    maxHeight: SHEET_HEIGHT,
    flexShrink: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceLight,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
  },
  commentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  commentBody: { flex: 1 },
  commentMenuBtn: {
    paddingLeft: spacing.sm,
    justifyContent: "center",
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  commentUser: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  commentTime: {
    color: colors.textDim,
    fontSize: fonts.caption,
  },
  commentText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    marginTop: 2,
  },
  empty: {
    color: colors.textDim,
    fontSize: fonts.small,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
  loadingSpinner: {
    marginTop: spacing.xxl,
  },
  sendError: {
    color: colors.textSecondary,
    fontSize: fonts.caption,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fonts.small,
    maxHeight: 80,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
