import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Contacts from "expo-contacts";
import * as Haptics from "expo-haptics";
import { decode } from "base64-arraybuffer";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import Animated, {
  FadeInRight,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { supabase } from "../lib/supabase";
import { useProfile } from "../lib/ProfileContext";
import Avatar from "../components/Avatar";
import { colors, spacing, fonts, radii } from "../components/theme";

const TOTAL_STEPS = 7;
const USERNAME_REGEX = /^[a-z0-9._]{3,20}$/;
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const EULA_TEXT = `TERMS AND CONDITIONS OF USE — Blackout

1. ACCEPTANCE
By using Blackout, you accept these terms. If you do not agree, do not use the app.

2. REQUIREMENTS
You must be 18 years or older. By signing up, you confirm that you meet this requirement.

3. CONTENT
All uploaded content is ephemeral and is automatically deleted after 24 hours. You are responsible for the content you upload. The following is not permitted:
- Sexually explicit content or nudity
- Violence or threats
- Harassment or bullying
- Content involving minors
- Illegal content

4. ZERO TOLERANCE POLICY
Blackout has a zero tolerance policy toward objectionable or abusive content. Violations will result in immediate content removal and possible account suspension.

5. PRIVACY
Your location is used to show you nearby parties. We do not sell your data to third parties. Photos and videos are stored temporarily (24h) and then deleted.

6. MODERATION
We reserve the right to remove content and suspend accounts that violate these terms. Reports are reviewed within 24 hours.

7. ACCOUNT DELETION
You can delete your account at any time from your profile settings. All your data will be permanently deleted.

8. CHANGES
We may modify these terms. We will notify you of significant changes.

9. LIMITATION OF LIABILITY
Blackout is not responsible for the actions of other users or the content they upload.

Last updated: June 2026`;

type UsernameStatus = "idle" | "invalid" | "checking" | "available" | "taken";
type ContactsState = "idle" | "loading" | "connected" | "denied";

interface SuggestedUser {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { refreshProfile } = useProfile();

  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  // Step 1 — Edad
  const [birthdate, setBirthdate] = useState(new Date(2000, 0, 1));

  // Step 2 — Términos
  const [eulaScrolled, setEulaScrolled] = useState(false);
  const [eulaContentHeight, setEulaContentHeight] = useState(0);
  const [eulaLayoutHeight, setEulaLayoutHeight] = useState(0);

  // Step 3 — Usuario
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const usernameSeq = useRef(0);

  // Step 4 — Nombre y foto
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [bio, setBio] = useState("");

  // Step 5 — Teléfono
  const [phone, setPhone] = useState("");

  // Step 6 — Amigos
  const [contactsState, setContactsState] = useState<ContactsState>("idle");
  const [contactMatches, setContactMatches] = useState<SuggestedUser[]>([]);
  const [suggested, setSuggested] = useState<SuggestedUser[]>([]);
  const [suggestedLoaded, setSuggestedLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SuggestedUser[]>([]);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const searchSeq = useRef(0);

  // Progress bar
  const progress = useSharedValue(1 / TOTAL_STEPS);
  useEffect(() => {
    progress.value = withTiming((stepIndex + 1) / TOTAL_STEPS, {
      duration: 300,
    });
  }, [stepIndex, progress]);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setMyId(user.id);
    });
  }, []);

  // If the EULA fits without scrolling, enable the accept button right away —
  // otherwise the near-bottom scroll detection can never fire.
  useEffect(() => {
    if (
      eulaContentHeight > 0 &&
      eulaLayoutHeight > 0 &&
      eulaContentHeight <= eulaLayoutHeight + 50
    ) {
      setEulaScrolled(true);
    }
  }, [eulaContentHeight, eulaLayoutHeight]);

  // Debounced username availability check
  useEffect(() => {
    if (!username) {
      setUsernameStatus("idle");
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const seq = ++usernameSeq.current;
    const timer = setTimeout(async () => {
      let query = supabase
        .from("profiles")
        .select("id")
        .eq("username", username);
      if (myId) query = query.neq("id", myId);
      const { data } = await query.maybeSingle();
      if (seq !== usernameSeq.current) return;
      setUsernameStatus(data ? "taken" : "available");
    }, 400);
    return () => clearTimeout(timer);
  }, [username, myId]);

  // Debounced user search (step 6)
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      let query = supabase
        .from("profiles")
        .select("id, username, avatar_url, bio")
        .ilike("username", `%${q}%`)
        .limit(20);
      if (myId) query = query.neq("id", myId);
      const { data } = await query;
      if (seq !== searchSeq.current) return;
      setSearchResults((data ?? []) as SuggestedUser[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, myId]);

  // Load suggested users when arriving at step 6
  useEffect(() => {
    if (stepIndex !== 5 || suggestedLoaded || !myId) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio")
        .neq("id", myId)
        .order("created_at", { ascending: false })
        .limit(15);
      setSuggested((data ?? []) as SuggestedUser[]);
      setSuggestedLoaded(true);
    })();
  }, [stepIndex, suggestedLoaded, myId]);

  function goBack() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  function getAge(date: Date): number {
    const today = new Date();
    let age = today.getFullYear() - date.getFullYear();
    const monthDiff = today.getMonth() - date.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
      age--;
    }
    return age;
  }

  // --- Step 1: Edad ---
  async function handleAgeNext() {
    const age = getAge(birthdate);
    if (age < 18) {
      Alert.alert(
        "Aún no",
        "Blackout es solo para mayores de 18 años. Te esperamos cuando los cumplas."
      );
      return;
    }
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ birthdate: birthdate.toISOString().split("T")[0] })
        .eq("id", user.id);
      if (error) {
        setLoading(false);
        Alert.alert("Ups", "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
    }
    setLoading(false);
    setStepIndex(1);
  }

  // --- Step 2: Términos ---
  function handleEulaScroll(event: any) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 50;
    if (nearBottom) setEulaScrolled(true);
  }

  async function handleEulaAccept() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ eula_accepted_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        setLoading(false);
        Alert.alert("Ups", "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
    }
    setLoading(false);
    setStepIndex(2);
  }

  // --- Step 3: Usuario ---
  function onChangeUsername(value: string) {
    const clean = value
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, "")
      .slice(0, 20);
    setUsername(clean);
  }

  async function handleUsernameNext() {
    if (usernameStatus !== "available") return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      Alert.alert("Ups", "No hay una sesión activa. Inicia sesión de nuevo.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ username })
      .eq("id", user.id);
    setLoading(false);
    if (error) {
      if (error.code === "23505") {
        setUsernameStatus("taken");
      } else {
        Alert.alert("Ups", "No se pudo guardar. Intenta de nuevo.");
      }
      return;
    }
    setStepIndex(3);
  }

  // --- Step 4: Nombre y foto ---
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
        Alert.alert("Ups", "No se pudo subir la foto. Intenta de nuevo.");
        setUploadingAvatar(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(fileName);

      const newAvatarUrl = `${publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: newAvatarUrl })
        .eq("id", user.id);

      if (updateError) {
        Alert.alert("Ups", "No se pudo guardar la foto. Intenta de nuevo.");
      } else {
        setAvatarUrl(newAvatarUrl);
      }
    } catch {
      Alert.alert("Ups", "No se pudo subir la foto. Intenta de nuevo.");
    }
    setUploadingAvatar(false);
  }

  async function handleProfileNext() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && bio.trim()) {
      await supabase
        .from("profiles")
        .update({ bio: bio.trim() })
        .eq("id", user.id);
    }
    setLoading(false);
    setStepIndex(4);
  }

  // --- Step 5: Teléfono ---
  const phoneValid = phone.length === 0 || phone.length === 10;

  async function handlePhoneNext() {
    if (!phoneValid) return;
    if (phone.length === 10) {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase
          .from("profiles")
          .update({ phone: `+52${phone}` })
          .eq("id", user.id);
        if (error) {
          setLoading(false);
          Alert.alert("Ups", "No se pudo guardar tu número. Inténtalo de nuevo u omite este paso.");
          return;
        }
      }
      setLoading(false);
    }
    setStepIndex(5);
  }

  // --- Step 6: Amigos ---
  async function syncContacts() {
    setContactsState("loading");
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        setContactsState("denied");
        return;
      }
      const { data: deviceContacts } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const phoneVariants = new Set<string>();
      for (const contact of deviceContacts ?? []) {
        for (const p of contact.phoneNumbers ?? []) {
          const digits = (p.number ?? "").replace(/\D/g, "");
          if (digits.length < 10) continue;
          const last10 = digits.slice(-10);
          phoneVariants.add(last10);
          phoneVariants.add(`+52${last10}`);
        }
      }

      const matches: SuggestedUser[] = [];
      const seen = new Set<string>();
      for (const chunk of chunkArray([...phoneVariants], 200)) {
        let query = supabase
          .from("profiles")
          .select("id, username, avatar_url, bio")
          .in("phone", chunk);
        if (myId) query = query.neq("id", myId);
        const { data } = await query;
        for (const row of (data ?? []) as SuggestedUser[]) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            matches.push(row);
          }
        }
      }
      setContactMatches(matches);
      setContactsState("connected");
    } catch {
      setContactsState("idle");
      Alert.alert("Ups", "No se pudieron leer tus contactos. Intenta de nuevo.");
    }
  }

  async function followUser(target: SuggestedUser) {
    if (!myId || followed[target.id]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Optimistic: accounts are request-based, so the follow lands as pending
    setFollowed((prev) => ({ ...prev, [target.id]: true }));
    const { error } = await supabase.from("follows").insert({
      follower_id: myId,
      following_id: target.id,
    });
    if (error) {
      setFollowed((prev) => ({ ...prev, [target.id]: false }));
      Alert.alert("Error", "No se pudo enviar la solicitud. Intenta de nuevo.");
    }
  }

  // --- Step 7: Notificaciones + finish ---
  const finishOnboarding = useCallback(
    async (requestNotifications: boolean) => {
      if (requestNotifications && Platform.OS !== "web") {
        try {
          await Notifications.requestPermissionsAsync();
        } catch {
          // Permission errors shouldn't block finishing onboarding
        }
      }

      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert("Ups", "No hay una sesión activa. Inicia sesión de nuevo.");
        setLoading(false);
        return;
      }

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!profileRow) {
        const { error: insertErr } = await supabase.from("profiles").insert({
          id: user.id,
          username: username || `user_${user.id.slice(0, 8)}`,
          onboarding_completed: true,
          birthdate: birthdate.toISOString().split("T")[0],
          eula_accepted_at: new Date().toISOString(),
        });
        if (insertErr) {
          Alert.alert("Ups", "No se pudo crear tu perfil. Inténtalo de nuevo.");
          setLoading(false);
          return;
        }
      } else {
        const { error: updateErr } = await supabase
          .from("profiles")
          .update({ onboarding_completed: true })
          .eq("id", user.id);
        if (updateErr) {
          Alert.alert(
            "Ups",
            "No se pudo actualizar tu perfil. Inténtalo de nuevo."
          );
          setLoading(false);
          return;
        }
      }

      await refreshProfile();
      setLoading(false);
      router.replace("/(tabs)/feed");
    },
    [username, birthdate, refreshProfile, router]
  );

  // --- Shared chrome ---
  function renderHeader() {
    return (
      <View style={styles.header}>
        {stepIndex > 0 ? (
          <TouchableOpacity onPress={goBack} hitSlop={HIT_SLOP}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, progressStyle]} />
        </View>
        <View style={styles.backPlaceholder} />
      </View>
    );
  }

  function renderFooter(opts: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    onSkip?: () => void;
  }) {
    const isDisabled = opts.disabled || loading;
    return (
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, isDisabled && styles.ctaDisabled]}
          onPress={opts.onPress}
          disabled={isDisabled}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.ctaText}>{opts.title}</Text>
          )}
        </TouchableOpacity>
        {opts.onSkip ? (
          <TouchableOpacity
            onPress={opts.onSkip}
            disabled={loading}
            hitSlop={HIT_SLOP}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>Omitir por ahora</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  function renderTitle(title: string, subtitle?: string) {
    return (
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    );
  }

  function renderUsernameStatus() {
    switch (usernameStatus) {
      case "checking":
        return (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.statusTextMuted}>Comprobando...</Text>
          </View>
        );
      case "available":
        return (
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            <Text style={styles.statusTextOk}>Disponible</Text>
          </View>
        );
      case "taken":
        return (
          <View style={styles.statusRow}>
            <Ionicons name="close-circle" size={16} color={colors.error} />
            <Text style={styles.statusTextError}>
              Ese usuario ya está ocupado
            </Text>
          </View>
        );
      case "invalid":
        return (
          <View style={styles.statusRow}>
            <Text style={styles.statusTextMuted}>
              3-20 caracteres: letras minúsculas, números, puntos o guiones
              bajos
            </Text>
          </View>
        );
      default:
        return <View style={styles.statusRow} />;
    }
  }

  function renderFollowRow({ item }: { item: SuggestedUser }) {
    const isFollowed = !!followed[item.id];
    return (
      <View style={styles.userRow}>
        <Avatar username={item.username} avatarUrl={item.avatar_url} size="md" />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.username}
          </Text>
          {item.bio ? (
            <Text style={styles.userBio} numberOfLines={1}>
              {item.bio}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.followBtn, isFollowed && styles.followBtnDone]}
          onPress={() => followUser(item)}
          disabled={isFollowed}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.followBtnText, isFollowed && styles.followBtnTextDone]}
          >
            {isFollowed ? "Solicitado" : "Seguir"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Steps ---
  function renderStep() {
    switch (stepIndex) {
      case 0:
        return (
          <View style={styles.stepContent}>
            {renderTitle(
              "¿Cuándo naciste?",
              "Blackout es solo para mayores de 18 años"
            )}
            <View style={styles.centerFill}>
              <DateTimePicker
                value={birthdate}
                mode="date"
                display="spinner"
                onChange={(_, date) => date && setBirthdate(date)}
                maximumDate={new Date()}
                minimumDate={new Date(1940, 0, 1)}
                textColor={colors.text}
                themeVariant="dark"
              />
            </View>
            {renderFooter({ title: "Continuar", onPress: handleAgeNext })}
          </View>
        );

      case 1:
        return (
          <View style={styles.stepContent}>
            {renderTitle("Términos y condiciones")}
            <ScrollView
              style={styles.eulaScroll}
              onScroll={handleEulaScroll}
              scrollEventThrottle={200}
              onContentSizeChange={(_, height) => setEulaContentHeight(height)}
              onLayout={(e) => setEulaLayoutHeight(e.nativeEvent.layout.height)}
            >
              <Text style={styles.eulaText}>{EULA_TEXT}</Text>
            </ScrollView>
            {!eulaScrolled && (
              <Text style={styles.scrollHint}>
                Desliza hasta el final para aceptar
              </Text>
            )}
            {renderFooter({
              title: "Aceptar",
              onPress: handleEulaAccept,
              disabled: !eulaScrolled,
            })}
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContent}>
            {renderTitle(
              "Elige tu nombre de usuario",
              "Así te encontrará la gente en Blackout"
            )}
            <View style={styles.fieldWrap}>
              <View style={styles.inputPill}>
                <Text style={styles.atPrefix}>@</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={onChangeUsername}
                  placeholder="tuusuario"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  autoFocus
                />
              </View>
              {renderUsernameStatus()}
            </View>
            <View style={styles.flexSpacer} />
            {renderFooter({
              title: "Continuar",
              onPress: handleUsernameNext,
              disabled: usernameStatus !== "available",
            })}
          </View>
        );

      case 3:
        return (
          <View style={styles.stepContent}>
            {renderTitle("Añade tu nombre y foto", "Puedes cambiar esto después.")}
            <View style={styles.avatarSection}>
              <TouchableOpacity
                onPress={pickAndUploadAvatar}
                activeOpacity={0.8}
                disabled={uploadingAvatar}
              >
                <View style={styles.avatarCircle}>
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={styles.avatarImage}
                      transition={200}
                    />
                  ) : uploadingAvatar ? (
                    <ActivityIndicator color={colors.textMuted} />
                  ) : (
                    <Ionicons
                      name="person"
                      size={48}
                      color={colors.textDim}
                    />
                  )}
                </View>
                <View style={styles.avatarPlusChip}>
                  <Ionicons name="add" size={16} color={colors.background} />
                </View>
              </TouchableOpacity>
            </View>
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Bio</Text>
              <View style={styles.inputPill}>
                <TextInput
                  style={styles.input}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Cuéntanos de ti..."
                  placeholderTextColor={colors.textDim}
                  maxLength={150}
                />
                {bio.trim().length > 0 && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.accent}
                  />
                )}
              </View>
            </View>
            <View style={styles.flexSpacer} />
            {renderFooter({
              title: "Continuar",
              onPress: handleProfileNext,
              onSkip: () => setStepIndex(4),
            })}
          </View>
        );

      case 4:
        return (
          <View style={styles.stepContent}>
            {renderTitle(
              "Añade tu número",
              "Lo usamos para que tus amigos te encuentren"
            )}
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Opcional</Text>
              <View style={styles.inputPill}>
                <View style={styles.countryChip}>
                  <Text style={styles.countryChipText}>🇲🇽 +52</Text>
                </View>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))}
                  placeholder="55 1234 5678"
                  placeholderTextColor={colors.textDim}
                  keyboardType="number-pad"
                  maxLength={10}
                />
                {phone.length === 10 && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.accent}
                  />
                )}
              </View>
            </View>
            <View style={styles.flexSpacer} />
            {renderFooter({
              title: "Continuar",
              onPress: handlePhoneNext,
              disabled: !phoneValid,
              onSkip: () => setStepIndex(5),
            })}
          </View>
        );

      case 5: {
        const matchIds = new Set(contactMatches.map((m) => m.id));
        const showingSearch = search.trim().length > 0;
        const listData = showingSearch
          ? searchResults
          : [...contactMatches, ...suggested.filter((s) => !matchIds.has(s.id))];
        return (
          <View style={styles.stepContent}>
            {renderTitle(
              "Encuentra a tus amigos",
              "Gente que podrías conocer en Blackout"
            )}

            <View style={styles.contactsCard}>
              <View style={styles.contactsIconWrap}>
                <Ionicons name="people" size={22} color={colors.text} />
              </View>
              <View style={styles.contactsInfo}>
                <Text style={styles.contactsTitle}>Sincronizar contactos</Text>
                <Text style={styles.contactsSub}>
                  {contactsState === "denied"
                    ? "Sin acceso a contactos"
                    : "Encuentra a tus amigos"}
                </Text>
              </View>
              {contactsState === "connected" ? (
                <View style={styles.connectedChip}>
                  <Text style={styles.connectedChipText}>Conectado ✓</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.connectBtn}
                  onPress={syncContacts}
                  disabled={contactsState === "loading"}
                  activeOpacity={0.8}
                >
                  {contactsState === "loading" ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : (
                    <Text style={styles.connectBtnText}>Conectar</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.inputPill, styles.searchPill]}>
              <Ionicons name="search" size={18} color={colors.textDim} />
              <TextInput
                style={styles.input}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar usuarios..."
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={listData}
              keyExtractor={(item) => item.id}
              renderItem={renderFollowRow}
              style={styles.userList}
              ListHeaderComponent={
                !showingSearch && contactMatches.length > 0 ? (
                  <Text style={styles.sectionLabel}>De tus contactos</Text>
                ) : null
              }
              ListEmptyComponent={
                <Text style={styles.emptyList}>
                  {showingSearch
                    ? "No encontramos a nadie con ese nombre"
                    : "Aún no hay sugerencias"}
                </Text>
              }
              keyboardShouldPersistTaps="handled"
            />

            {renderFooter({
              title: "Continuar",
              onPress: () => setStepIndex(6),
              onSkip: () => setStepIndex(6),
            })}
          </View>
        );
      }

      case 6:
        return (
          <View style={styles.stepContent}>
            {renderTitle(
              "¡No te pierdas nada!",
              "Likes, seguidores y pedas cerca de ti"
            )}
            <View style={styles.centerFill} pointerEvents="none">
              <View style={styles.mockStack}>
                <View style={[styles.mockCard, styles.mockCardBack]}>
                  <View style={styles.mockAvatar} />
                  <View style={styles.mockTextWrap}>
                    <Text style={styles.mockText} numberOfLines={1}>
                      <Text style={styles.mockBold}>leo</Text> le dio like a tu
                      foto
                    </Text>
                    <Text style={styles.mockTime}>hace 2m</Text>
                  </View>
                </View>
                <View style={[styles.mockCard, styles.mockCardMid]}>
                  <View style={styles.mockAvatar} />
                  <View style={styles.mockTextWrap}>
                    <Text style={styles.mockText} numberOfLines={1}>
                      <Text style={styles.mockBold}>sant</Text> empezó a
                      seguirte
                    </Text>
                    <Text style={styles.mockTime}>hace 5m</Text>
                  </View>
                </View>
                <View style={[styles.mockCard, styles.mockCardFront]}>
                  <View style={styles.mockAvatar}>
                    <Ionicons name="flash" size={16} color={colors.background} />
                  </View>
                  <View style={styles.mockTextWrap}>
                    <Text style={styles.mockText} numberOfLines={1}>
                      Peda nueva cerca de ti ⚡
                    </Text>
                    <Text style={styles.mockTime}>ahora</Text>
                  </View>
                </View>
              </View>
            </View>
            {renderFooter({
              title: "Permitir notificaciones",
              onPress: () => finishOnboarding(true),
              onSkip: () => finishOnboarding(false),
            })}
          </View>
        );

      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {renderHeader()}
        <Animated.View
          key={stepIndex}
          entering={FadeInRight.duration(250)}
          exiting={FadeOut.duration(120)}
          style={styles.flex}
        >
          {renderStep()}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backPlaceholder: { width: 26 },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
  },
  titleBlock: {
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: fonts.body,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  centerFill: {
    flex: 1,
    justifyContent: "center",
  },
  flexSpacer: { flex: 1 },
  footer: {
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  cta: {
    backgroundColor: colors.accent,
    height: 56,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    color: colors.background,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  skipBtn: {
    alignSelf: "center",
    marginTop: spacing.lg,
  },
  skipText: {
    color: colors.textMuted,
    fontSize: fonts.small,
    fontWeight: "600",
  },
  // EULA
  eulaScroll: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  eulaText: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    lineHeight: 22,
    paddingBottom: spacing.lg,
  },
  scrollHint: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    textAlign: "center",
    marginTop: spacing.md,
  },
  // Inputs
  fieldWrap: {
    gap: spacing.sm,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginLeft: spacing.xs,
  },
  inputPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    height: 56,
    gap: spacing.sm,
  },
  atPrefix: {
    color: colors.textMuted,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fonts.body,
    height: "100%",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 20,
    marginLeft: spacing.xs,
  },
  statusTextMuted: {
    color: colors.textMuted,
    fontSize: fonts.caption,
  },
  statusTextOk: {
    color: colors.accent,
    fontSize: fonts.caption,
    fontWeight: "600",
  },
  statusTextError: {
    color: colors.error,
    fontSize: fonts.caption,
    fontWeight: "600",
  },
  // Avatar step
  avatarSection: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarPlusChip: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.background,
  },
  // Phone step
  countryChip: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  countryChipText: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "600",
  },
  // Friends step
  contactsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  contactsIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  contactsInfo: { flex: 1 },
  contactsTitle: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  contactsSub: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: 2,
  },
  connectBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    height: 34,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  connectBtnText: {
    color: colors.background,
    fontSize: fonts.caption,
    fontWeight: "700",
  },
  connectedChip: {
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  connectedChipText: {
    color: colors.textSecondary,
    fontSize: fonts.caption,
    fontWeight: "700",
  },
  searchPill: {
    height: 48,
    marginBottom: spacing.sm,
  },
  userList: { flex: 1 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingVertical: spacing.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  userInfo: { flex: 1 },
  userName: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "700",
  },
  userBio: {
    color: colors.textMuted,
    fontSize: fonts.caption,
    marginTop: 1,
  },
  followBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    height: 32,
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
  },
  followBtnDone: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    color: colors.background,
    fontSize: fonts.caption,
    fontWeight: "700",
  },
  followBtnTextDone: {
    color: colors.textSecondary,
  },
  emptyList: {
    color: colors.textDim,
    fontSize: fonts.small,
    textAlign: "center",
    paddingVertical: spacing.xxl,
  },
  // Notifications mock
  mockStack: {
    gap: spacing.md,
  },
  mockCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  mockCardBack: {
    opacity: 0.5,
    transform: [{ scale: 0.94 }, { rotate: "-1.5deg" }],
    marginBottom: -spacing.sm,
  },
  mockCardMid: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }, { rotate: "1deg" }],
    marginBottom: -spacing.sm,
  },
  mockCardFront: {
    transform: [{ rotate: "-0.5deg" }],
  },
  mockAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  mockTextWrap: { flex: 1 },
  mockText: {
    color: colors.text,
    fontSize: fonts.small,
  },
  mockBold: {
    fontWeight: "800",
  },
  mockTime: {
    color: colors.textDim,
    fontSize: fonts.caption,
    marginTop: 2,
  },
});
