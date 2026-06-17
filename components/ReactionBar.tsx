import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { colors, fonts, spacing, radii } from "./theme";

interface Props {
  fire: number;
  beer: number;
  skull: number;
  onReact: (type: "fire" | "beer" | "skull") => void;
}

const REACTIONS: { type: "fire" | "beer" | "skull"; emoji: string }[] = [
  { type: "fire", emoji: "🔥" },
  { type: "beer", emoji: "🍻" },
  { type: "skull", emoji: "💀" },
];

export default function ReactionBar({ fire, beer, skull, onReact }: Props) {
  const counts = { fire, beer, skull };

  return (
    <View style={styles.container}>
      {REACTIONS.map((r) => (
        <TouchableOpacity
          key={r.type}
          style={styles.button}
          onPress={() => onReact(r.type)}
          activeOpacity={0.6}
        >
          <Text style={styles.emoji}>{r.emoji}</Text>
          {counts[r.type] > 0 && (
            <Text style={styles.count}>{counts[r.type]}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
  },
  emoji: {
    fontSize: fonts.body,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fonts.caption,
    fontWeight: "600",
  },
});
