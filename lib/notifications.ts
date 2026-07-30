import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushToken(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;

  const { data: tokenData } = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("profiles")
      .update({ push_token: tokenData })
      .eq("id", user.id);
  }

  return tokenData;
}

async function sendPush(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: pushToken,
      title,
      body,
      data,
      sound: "default",
    }),
  }).catch(() => {});
}

export async function sendPushNotification(
  targetUserId: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("push_token")
    .eq("id", targetUserId)
    .single();

  if (!profile?.push_token) return;
  await sendPush(profile.push_token, title, body, data);
}

export type NotificationType =
  | "follow_request"
  | "follow_accepted"
  | "like"
  | "comment";

export async function notify(
  targetUserId: string,
  type: NotificationType,
  opts?: { postId?: string; commentText?: string }
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id === targetUserId) return;

  await supabase.from("notifications").insert({
    user_id: targetUserId,
    actor_id: user.id,
    type,
    post_id: opts?.postId ?? null,
    comment_text: opts?.commentText ?? null,
  });

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const name = myProfile?.username ?? "Someone";

  const messages: Record<NotificationType, string> = {
    follow_request: `${name} wants to follow you`,
    follow_accepted: `${name} accepted your follow request`,
    like: `${name} liked your post`,
    comment: opts?.commentText
      ? `${name} commented: "${opts.commentText.length > 50 ? opts.commentText.slice(0, 50) + "…" : opts.commentText}"`
      : `${name} commented on your post`,
  };

  const screens: Record<NotificationType, string> = {
    follow_request: "follow-requests",
    follow_accepted: "user",
    like: "notifications",
    comment: "notifications",
  };

  sendPushNotification(targetUserId, "Blackout", messages[type], {
    screen: screens[type],
    userId: user.id,
  });
}
