import { View, Text, StyleSheet } from "react-native";
import { colors, fonts, radii, spacing } from "./theme";

interface Props {
  attendeeCount: number;
}

function getHeat(count: number): { emoji: string; color: string } {
  if (count >= 20) return { emoji: "🔥🔥🔥", color: "#ef4444" };
  if (count >= 10) return { emoji: "🔥🔥", color: "#f97316" };
  if (count >= 3) return { emoji: "🔥", color: "#eab308" };
  return { emoji: "✨", color: colors.textMuted };
}

export default function HeatBadge({ attendeeCount }: Props) {
  const { emoji, color } = getHeat(attendeeCount);

  return (
    <View style={styles.badge}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.count, { color }]}>{attendeeCount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  emoji: {
    fontSize: fonts.caption,
  },
  count: {
    fontSize: fonts.caption,
    fontWeight: "700",
  },
});
