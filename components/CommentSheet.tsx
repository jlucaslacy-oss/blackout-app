import { useState, useEffect, useCallback } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { Comment } from "../lib/types";
import Avatar from "./Avatar";
import { colors, spacing, fonts, radii } from "./theme";

interface Props {
  postId: string | null;
  visible: boolean;
  onClose: () => void;
  onCommentAdded?: () => void;
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
  visible,
  onClose,
  onCommentAdded,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from("comments")
      .select("*, profiles(*)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (data) setComments(data as Comment[]);
  }, [postId]);

  useEffect(() => {
    if (visible && postId) fetchComments();
    if (!visible) {
      setComments([]);
      setText("");
    }
  }, [visible, postId, fetchComments]);

  useEffect(() => {
    if (!visible || !postId) return;
    const channel = supabase
      .channel(`comments-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${postId}`,
        },
        () => fetchComments()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [visible, postId, fetchComments]);

  async function sendComment() {
    if (!text.trim() || !postId) return;
    setSending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSending(false);
      return;
    }
    await supabase.from("comments").insert({
      user_id: user.id,
      post_id: postId,
      text: text.trim(),
    });
    setText("");
    setSending(false);
    onCommentAdded?.();
    fetchComments();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.sheet}>
          <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
            <View style={styles.header}>
              <Text style={styles.title}>Comentarios</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => (
                <View style={styles.commentRow}>
                  <Avatar
                    username={item.profiles?.username ?? "?"}
                    avatarUrl={item.profiles?.avatar_url}
                    size="sm"
                  />
                  <View style={styles.commentBody}>
                    <View style={styles.commentHeader}>
                      <Text style={styles.commentUser}>
                        {item.profiles?.username}
                      </Text>
                      <Text style={styles.commentTime}>
                        {timeAgo(item.created_at)}
                      </Text>
                    </View>
                    <Text style={styles.commentText}>{item.text}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>Sin comentarios aún</Text>
              }
            />

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
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
              >
                <Ionicons name="send" size={20} color={colors.background} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "70%",
  },
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
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
    padding: spacing.lg,
  },
  commentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  commentBody: { flex: 1 },
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
