import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { colors, fonts, spacing, radii } from "./theme";

type ReactionType = "fire" | "beer" | "skull";

interface Props {
  fire: number;
  beer: number;
  skull: number;
  onReact: (type: ReactionType) => void;
  /** Optional: the current user's reaction, for active-chip styling */
  myReaction?: ReactionType | null;
}

const REACTIONS: { type: ReactionType; emoji: string }[] = [
  { type: "fire", emoji: "🔥" },
  { type: "beer", emoji: "🍻" },
  { type: "skull", emoji: "💀" },
];

function ReactionChip({
  emoji,
  count,
  active,
  onPress,
}: {
  emoji: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePress() {
    Haptics.selectionAsync();
    scale.value = withSequence(
      withTiming(0.85, { duration: 70 }),
      withSpring(1, { damping: 10, stiffness: 300 })
    );
    onPress();
  }

  return (
    <Pressable onPress={handlePress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Animated.View
        style={[styles.button, active && styles.buttonActive, animatedStyle]}
      >
        <Text style={styles.emoji}>{emoji}</Text>
        {count > 0 && (
          <Text style={[styles.count, active && styles.countActive]}>
            {count}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default function ReactionBar({
  fire,
  beer,
  skull,
  onReact,
  myReaction,
}: Props) {
  const counts = { fire, beer, skull };

  return (
    <View style={styles.container}>
      {REACTIONS.map((r) => (
        <ReactionChip
          key={r.type}
          emoji={r.emoji}
          count={counts[r.type]}
          active={myReaction === r.type}
          onPress={() => onReact(r.type)}
        />
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
    borderWidth: 1,
    borderColor: "transparent",
  },
  buttonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceLight,
  },
  emoji: {
    fontSize: fonts.body,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fonts.caption,
    fontWeight: "600",
  },
  countActive: {
    color: colors.text,
    fontWeight: "700",
  },
});
