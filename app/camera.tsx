import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import { decode } from "base64-arraybuffer";
import { supabase } from "../lib/supabase";
import Button from "../components/Button";
import { colors, spacing, fonts } from "../components/theme";

type CameraMode = "picture" | "video";

export default function CameraScreen() {
  const { pedaId } = useLocalSearchParams<{ pedaId?: string }>();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [mode, setMode] = useState<CameraMode>("picture");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedType, setCapturedType] = useState<"photo" | "video">("photo");
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) {
      setCapturedUri(photo.uri);
      setCapturedType("photo");
    }
  }

  async function startRecording() {
    if (!cameraRef.current) return;
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

    const video = await cameraRef.current.recordAsync({ maxDuration: 15 });
    if (video) {
      setCapturedUri(video.uri);
      setCapturedType("video");
    }
  }

  async function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    cameraRef.current?.stopRecording();
  }

  async function upload() {
    if (!capturedUri) return;

    setUploading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      return;
    }

    const isFeedPost = !pedaId;
    const bucket = isFeedPost ? "feed-media" : "peda-media";
    const ext = capturedType === "photo" ? "jpg" : "mp4";
    const fileName = `${user.id}/${Date.now()}.${ext}`;
    const contentType =
      capturedType === "photo" ? "image/jpeg" : "video/mp4";

    const base64 = await FileSystem.readAsStringAsync(capturedUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, decode(base64), { contentType });

    if (uploadError) {
      Alert.alert("Error", uploadError.message);
      setUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(fileName);

    const postData: any = {
      user_id: user.id,
      media_url: publicUrl,
      media_type: capturedType,
      thumbnail_url: capturedType === "photo" ? publicUrl : null,
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

    router.back();
  }

  if (!permission?.granted) {
    return (
      <View style={styles.permContainer}>
        <Ionicons name="camera-outline" size={48} color={colors.textDim} />
        <Text style={styles.permText}>
          Blackout necesita acceso a tu cámara
        </Text>
        <Button title="Permitir cámara" onPress={requestPermission} />
      </View>
    );
  }

  if (capturedUri) {
    return (
      <View style={styles.previewContainer}>
        <Image
          source={{ uri: capturedUri }}
          style={styles.preview}
          resizeMode="cover"
        />
        <View style={styles.previewActions}>
          <Button
            title="Repetir"
            variant="outline"
            onPress={() => setCapturedUri(null)}
            style={styles.previewBtn}
          />
          <Button
            title="Enviar"
            onPress={upload}
            loading={uploading}
            style={styles.previewBtn}
          />
        </View>
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
      />

      {/* Close button */}
      <TouchableOpacity
        style={styles.closeBtn}
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={28} color={colors.text} />
      </TouchableOpacity>

      {/* Recording timer */}
      {recording && (
        <View style={styles.timerBadge}>
          <View style={styles.timerDot} />
          <Text style={styles.timerText}>
            {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:
            {String(recordSeconds % 60).padStart(2, "0")}
          </Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => setMode("picture")}
            disabled={recording}
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
            onPress={() => setMode("video")}
            disabled={recording}
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
          {/* Flip camera */}
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={() =>
              setFacing((f) => (f === "back" ? "front" : "back"))
            }
            disabled={recording}
          >
            <Ionicons name="camera-reverse" size={28} color={colors.text} />
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

          {/* Placeholder for symmetry */}
          <View style={styles.sideBtn} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  permContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  permText: {
    color: colors.textSecondary,
    fontSize: fonts.body,
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 60,
    left: spacing.xl,
    zIndex: 10,
  },
  timerBadge: {
    position: "absolute",
    top: 60,
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
    paddingBottom: 50,
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
  previewActions: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.xl,
    paddingBottom: 50,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  previewBtn: {
    flex: 1,
  },
});
