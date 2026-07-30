import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors } from "./theme";

const SIZES = { sm: 32, md: 48, lg: 80 } as const;

interface Props {
  username: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
}

export default function Avatar({ username, avatarUrl, size = "md" }: Props) {
  const px = SIZES[size];
  const fontSize = px * 0.4;
  const initial = username && username !== "?" ? username[0].toUpperCase() : "";

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[styles.image, { width: px, height: px, borderRadius: px / 2 }]}
        transition={200}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: px, height: px, borderRadius: px / 2 },
        !initial && styles.loading,
      ]}
    >
      {initial ? (
        <Text style={[styles.initial, { fontSize }]}>{initial}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surface,
  },
  fallback: {
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  loading: {
    backgroundColor: colors.surface,
  },
  initial: {
    color: colors.background,
    fontWeight: "800",
  },
});
