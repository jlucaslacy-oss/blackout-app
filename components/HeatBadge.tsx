import { View, Text, StyleSheet } from "react-native";
import { colors, fonts, radii, spacing } from "./theme";

interface Props {
  attendeeCount: number;
  emoji?: string;
}

function getHeatColor(count: number): string {
  if (count >= 20) return "#ef4444";
  if (count >= 10) return "#f97316";
  if (count >= 3) return "#eab308";
  return colors.textMuted;
}

export default function HeatBadge({ attendeeCount, emoji }: Props) {
  const color = getHeatColor(attendeeCount);
  const display = emoji || "🎉";

  return (
    <View style={styles.badge}>
      <Text style={styles.emoji}>{display}</Text>
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
