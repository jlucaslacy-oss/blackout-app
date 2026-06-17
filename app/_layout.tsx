import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useRouter, useSegments } from "expo-router";
import { Profile } from "../lib/types";

function useProtectedRoute(session: Session | null, profile: Profile | null) {
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
      } else {
        router.replace("/(tabs)/feed");
      }
    } else if (session && !inOnboarding && profile && !profile.onboarding_completed) {
      router.replace("/onboarding");
    }
  }, [session, profile, segments]);
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data as Profile);
      });
  }, [session?.user?.id]);

  useProtectedRoute(session, profile);

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
