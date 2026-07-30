import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { decode } from "base64-arraybuffer";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import Button from "../components/Button";
import { colors, spacing, fonts } from "../components/theme";

type CameraMode = "picture" | "video";

const ICON_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function CameraScreen() {
  const { pedaId } = useLocalSearchParams<{ pedaId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [mode, setMode] = useState<CameraMode>("picture");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedType, setCapturedType] = useState<"photo" | "video">("photo");
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [fromGallery, setFromGallery] = useState(false);
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturingRef = useRef(false);
  const flashOpacity = useSharedValue(0);

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function takePicture() {
    if (!cameraRef.current || capturingRef.current) return;
    capturingRef.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      flashOpacity.value = 0.9;
      flashOpacity.value = withTiming(0, { duration: 280 });
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo) {
        setCapturedUri(photo.uri);
        setCapturedType("photo");
        setFromGallery(false);
      }
    } finally {
      capturingRef.current = false;
    }
  }

  async function startRecording() {
    if (!cameraRef.current || capturingRef.current) return;
    capturingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecording(true);
    setRecordSeconds(0);

    timerRef.current = setInterval(() => {
      setRecordSeconds((prev) => {
        if (prev >= 14) {
          stopRecording();
          return 15;
        }
        return prev + 1;
      });
    }, 1000);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 15 });
      if (video) {
        setCapturedUri(video.uri);
        setCapturedType("video");
        setFromGallery(false);
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(video.uri, { time: 0 });
          setPreviewThumb(thumb.uri);
        } catch {}
      }
    } finally {
      capturingRef.current = false;
    }
  }

  async function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecording(false);
    cameraRef.current?.stopRecording();
  }

  function switchMode(next: CameraMode) {
    if (next === mode) return;
    Haptics.selectionAsync();
    setMode(next);
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.7,
      videoMaxDuration: 15,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.type === "video" && (asset.duration ?? 0) > 15500) {
      Alert.alert("Ups", "El video debe durar máximo 15 segundos");
      return;
    }
    setCapturedUri(asset.uri);
    setCapturedType(asset.type === "video" ? "video" : "photo");
    setFromGallery(true);
    if (asset.type === "video") {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 });
        setPreviewThumb(thumb.uri);
      } catch {}
    } else {
      setPreviewThumb(null);
    }
  }

  async function upload() {
    if (!capturedUri) return;

    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setUploading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setUploading(false);
        return;
      }

      const isFeedPost = !pedaId;
      const bucket = isFeedPost ? "feed-media" : "peda-media";
      const ext = capturedType === "photo" ? "jpg" : "mp4";
      const fileName = `${user.id}/${Date.now()}.${ext}`;
      const contentType =
        capturedType === "photo" ? "image/jpeg" : "video/mp4";

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

      let uploadUri = capturedUri;
      if (capturedType === "photo") {
        const compressed = await manipulateAsync(
          capturedUri,
          [{ resize: { width: 1080 } }],
          { compress: 0.7, format: SaveFormat.JPEG }
        );
        uploadUri = compressed.uri;
      }

      const fileInfo = await FileSystem.getInfoAsync(uploadUri);
      if (!fileInfo.exists) {
        Alert.alert("Error", "No se encontró el archivo");
        setUploading(false);
        return;
      }

      const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${fileName}`;

      const response = await FileSystem.uploadAsync(uploadUrl, uploadUri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": contentType,
          "x-upsert": "false",
        },
      });

      if (response.status < 200 || response.status >= 300) {
        let msg = "No se pudo subir";
        try {
          const body = JSON.parse(response.body || "{}");
          msg = body.message || body.error || msg;
        } catch {}
        Alert.alert("Error", `${msg} (${response.status})`);
        setUploading(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(fileName);

      let thumbnailUrl: string | null =
        capturedType === "photo" ? publicUrl : null;

      if (capturedType === "video") {
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(capturedUri, {
            time: 0,
          });
          const thumbName = `${user.id}/${Date.now()}_thumb.jpg`;
          const thumbBase64 = await FileSystem.readAsStringAsync(thumb.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const { error: thumbError } = await supabase.storage
            .from(bucket)
            .upload(thumbName, decode(thumbBase64), {
              contentType: "image/jpeg",
            });
          if (!thumbError) {
            const {
              data: { publicUrl: thumbPublic },
            } = supabase.storage.from(bucket).getPublicUrl(thumbName);
            thumbnailUrl = thumbPublic;
          }
        } catch {}
      }

      let blurData: string | null = null;
      try {
        const blurSource =
          capturedType === "video" && thumbnailUrl
            ? (await VideoThumbnails.getThumbnailAsync(capturedUri, { time: 0 })).uri
            : capturedUri;
        const tiny = await manipulateAsync(
          blurSource,
          [{ resize: { width: 32 } }],
          { compress: 0.3, format: SaveFormat.JPEG }
        );
        const b64 = await FileSystem.readAsStringAsync(tiny.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        blurData = `data:image/jpeg;base64,${b64}`;
      } catch {}

      const postData: any = {
        user_id: user.id,
        media_url: publicUrl,
        media_type: capturedType,
        thumbnail_url: thumbnailUrl,
        blur_data: blurData,
        caption: caption.trim() || null,
      };
      if (pedaId) postData.peda_id = pedaId;

      const { error: postError } = await supabase
        .from("posts")
        .insert(postData);

      setUploading(false);

      if (postError) {
        Alert.alert("Error", postError.message);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/feed");
      }
    } catch (e: any) {
      console.error("[upload] error:", e);
      setUploading(false);
      Alert.alert("Error", e.message || "No se pudo subir");
    }
  }

  if (!permission?.granted) {
    const canAskAgain = permission?.canAskAgain !== false;
    return (
      <View style={styles.permContainer}>
        <TouchableOpacity
          style={[styles.permClose, { top: insets.top + spacing.sm }]}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/feed");
          }}
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="camera-outline" size={48} color={colors.textDim} />
        <Text style={styles.permText}>
          Blackout necesita acceso a tu cámara
        </Text>
        {canAskAgain ? (
          <Button title="Permitir cámara" onPress={requestPermission} />
        ) : (
          <>
            <Text style={styles.permHint}>
              Activa el permiso de cámara en los ajustes de tu teléfono
            </Text>
            <Button
              title="Abrir Ajustes"
              onPress={() => Linking.openSettings()}
            />
          </>
        )}
      </View>
    );
  }

  if (capturedUri) {
    return (
      <View style={styles.previewContainer}>
        <Image
          source={{ uri: capturedType === "video" && previewThumb ? previewThumb : capturedUri }}
          style={styles.preview}
          resizeMode="cover"
        />
        <TouchableOpacity
          style={[styles.previewClose, { top: insets.top + spacing.md }]}
          onPress={() => {
            if (uploading) return;
            setCapturedUri(null);
            setPreviewThumb(null);
            setCaption("");
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/feed");
          }}
          hitSlop={ICON_HIT_SLOP}
          accessibilityLabel="Cerrar"
        >
          <Ionicons name="close" size={30} color={colors.text} />
        </TouchableOpacity>
        {capturedType === "video" && (
          <View style={[styles.videoPreviewBadge, { top: insets.top + spacing.md }]}>
            <Ionicons name="videocam" size={20} color={colors.text} />
            <Text style={styles.videoPreviewText}>Video</Text>
          </View>
        )}
        {uploading && (
          <View style={styles.uploadOverlay}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.uploadText}>Subiendo...</Text>
          </View>
        )}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.previewBottom}
        >
          <View style={styles.captionRow}>
            <TextInput
              style={styles.captionInput}
              placeholder="Escribe algo..."
              placeholderTextColor={colors.textMuted}
              value={caption}
              onChangeText={setCaption}
              maxLength={200}
              multiline
              editable={!uploading}
              returnKeyType="done"
              blurOnSubmit
            />
          </View>
          <View
            style={[
              styles.previewActions,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
          >
            <Button
              title={fromGallery ? "Elegir otra" : "Repetir"}
              variant="outline"
              onPress={() => {
                if (fromGallery) {
                  // Keep the current preview under the picker sheet — no
                  // camera flash; cancel keeps the current selection.
                  pickFromGallery();
                } else {
                  setCapturedUri(null);
                  setPreviewThumb(null);
                  setCaption("");
                }
              }}
              style={styles.previewBtn}
              disabled={uploading}
            />
            <Button
              title="Publicar"
              onPress={upload}
              loading={uploading}
              style={styles.previewBtn}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode={mode}
        flash={flash}
      />

      {/* Photo capture flash */}
      <Animated.View
        pointerEvents="none"
        style={[styles.captureFlash, flashStyle]}
      />

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/feed");
          }}
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
          hitSlop={ICON_HIT_SLOP}
          style={[styles.flashBtn, flash === "on" && styles.flashBtnOn]}
        >
          <Ionicons
            name={flash === "on" ? "flash" : "flash-off-outline"}
            size={20}
            color={flash === "on" ? colors.background : colors.text}
          />
        </TouchableOpacity>
      </View>

      {/* Recording timer */}
      {recording && (
        <View style={[styles.timerBadge, { top: insets.top + spacing.sm }]}>
          <View style={styles.timerDot} />
          <Text style={styles.timerText}>
            {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:
            {String(recordSeconds % 60).padStart(2, "0")}
          </Text>
        </View>
      )}

      {/* Bottom controls */}
      <View
        style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => switchMode("picture")}
            disabled={recording}
            hitSlop={ICON_HIT_SLOP}
          >
            <Text
              style={[
                styles.modeText,
                mode === "picture" && styles.modeTextActive,
              ]}
            >
              Foto
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => switchMode("video")}
            disabled={recording}
            hitSlop={ICON_HIT_SLOP}
          >
            <Text
              style={[
                styles.modeText,
                mode === "video" && styles.modeTextActive,
              ]}
            >
              Video
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.captureRow}>
          {/* Gallery */}
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={pickFromGallery}
            disabled={recording}
            hitSlop={ICON_HIT_SLOP}
          >
            <Ionicons name="images-outline" size={28} color={colors.text} />
          </TouchableOpacity>

          {/* Capture button */}
          <TouchableOpacity
            style={[
              styles.captureBtn,
              recording && styles.captureBtnRecording,
            ]}
            onPress={
              mode === "picture"
                ? takePicture
                : recording
                ? stopRecording
                : startRecording
            }
            activeOpacity={0.7}
          >
            {recording ? (
              <View style={styles.stopSquare} />
            ) : (
              <View
                style={[
                  styles.captureInner,
                  mode === "video" && styles.captureInnerVideo,
                ]}
              />
            )}
          </TouchableOpacity>

          {/* Flip camera */}
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={() =>
              setFacing((f) => (f === "back" ? "front" : "back"))
            }
            disabled={recording}
            hitSlop={ICON_HIT_SLOP}
          >
            <Ionicons name="camera-reverse" size={28} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  captureFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    zIndex: 20,
  },
  permContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  permClose: {
    position: "absolute",
    left: spacing.xl,
    zIndex: 10,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  permText: {
    color: colors.textSecondary,
    fontSize: fonts.body,
    textAlign: "center",
  },
  permHint: {
    color: colors.textMuted,
    fontSize: fonts.small,
    textAlign: "center",
  },
  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    zIndex: 10,
  },
  flashBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  flashBtnOn: {
    backgroundColor: colors.accent,
  },
  timerBadge: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(239,68,68,0.8)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
  timerText: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.xl,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xxl,
    marginBottom: spacing.xl,
  },
  modeText: {
    color: colors.textMuted,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  modeTextActive: {
    color: colors.text,
  },
  captureRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
  },
  sideBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.text,
    justifyContent: "center",
    alignItems: "center",
  },
  captureBtnRecording: {
    borderColor: colors.error,
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.text,
  },
  captureInnerVideo: {
    backgroundColor: colors.error,
  },
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  preview: {
    flex: 1,
  },
  uploadOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    zIndex: 10,
  },
  uploadText: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "600",
  },
  previewClose: {
    position: "absolute",
    left: spacing.lg,
    zIndex: 5,
    padding: spacing.sm,
  },
  previewBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  captionRow: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  captionInput: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    color: colors.text,
    fontSize: fonts.body,
    maxHeight: 90,
  },
  previewActions: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  previewBtn: {
    flex: 1,
  },
  videoPreviewBadge: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  videoPreviewText: {
    color: colors.text,
    fontSize: fonts.small,
    fontWeight: "600",
  },
});
