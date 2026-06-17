import { Image, TouchableOpacity, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "./theme";

interface Props {
  mediaUrl: string;
  mediaType: "photo" | "video";
  size: number;
  onPress: () => void;
}

export default function MediaCard({ mediaUrl, mediaType, size, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.container, { width: size, height: size }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: mediaUrl }}
        style={[styles.image, { width: size, height: size }]}
      />
      {mediaType === "video" && (
        <View style={styles.videoIndicator}>
          <Ionicons name="play-circle" size={24} color={colors.text} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 0.5,
    position: "relative",
  },
  image: {
    backgroundColor: colors.surface,
  },
  videoIndicator: {
    position: "absolute",
    bottom: 4,
    right: 4,
  },
});
