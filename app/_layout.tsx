import { useEffect, useState, useRef } from "react";
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Animated,
} from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Session } from "@supabase/supabase-js";
import * as Notifications from "expo-notifications";
import { type EventSubscription } from "expo-modules-core";
import { supabase } from "../lib/supabase";
import { useRouter, useSegments } from "expo-router";
import { ProfileProvider, useProfile } from "../lib/ProfileContext";
import { registerPushToken } from "../lib/notifications";
import { colors } from "../components/theme";

function useProtectedRoute(session: Session | null) {
  const { profile } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      if (profile && !profile.onboarding_completed) {
        router.replace("/onboarding");
      } else if (profile && profile.onboarding_completed) {
        router.replace("/(tabs)/feed");
      }
    } else if (session && !inOnboarding && profile && !profile.onboarding_completed) {
      router.replace("/onboarding");
    }
  }, [session, profile, segments]);
}

function InnerLayout({ session }: { session: Session | null }) {
  useProtectedRoute(session);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="peda/[id]"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="camera"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="create-peda"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="user/[id]"
        options={{ presentation: "card" }}
      />
      <Stack.Screen
        name="follow-requests"
        options={{ presentation: "card" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashShownAt = useRef(Date.now());
  const router = useRouter();
  const responseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionChecked(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fade the splash as soon as the session check resolves and the first
  // route is mounted, keeping it on screen at least ~800ms so it never blinks.
  useEffect(() => {
    if (!sessionChecked) return;
    const elapsed = Date.now() - splashShownAt.current;
    const remaining = Math.max(0, 800 - elapsed);
    const timer = setTimeout(() => {
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setSplashDone(true));
    }, remaining);
    return () => clearTimeout(timer);
  }, [sessionChecked]);

  useEffect(() => {
    if (!session) return;

    registerPushToken();

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        if (data?.screen === "follow-requests") {
          router.push("/follow-requests");
        } else if (data?.screen === "user" && data.userId) {
          router.push(`/user/${data.userId}`);
        } else if (data?.screen === "notifications") {
          router.push("/(tabs)/notifications");
        }
      });

    return () => {
      responseListener.current?.remove();
    };
  }, [session]);

  if (!sessionChecked) {
    return (
      <View style={splashStyles.container}>
        <StatusBar style="light" />
        <Animated.Image
          source={require("../assets/icon.png")}
          style={[splashStyles.logo, { opacity: splashOpacity }]}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <ProfileProvider session={session}>
        <InnerLayout session={session} />
      </ProfileProvider>

      {!splashDone && (
        <Animated.View
          style={[splashStyles.container, splashStyles.overlay, { opacity: splashOpacity }]}
          pointerEvents="none"
        >
          <Animated.Image
            source={require("../assets/icon.png")}
            style={splashStyles.logo}
            resizeMode="contain"
          />
        </Animated.View>
      )}
    </View>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  logo: {
    width: 120,
    height: 120,
  },
});
