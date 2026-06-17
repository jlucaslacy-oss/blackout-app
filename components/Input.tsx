import { TextInput, StyleSheet, TextInputProps, View, Text } from "react-native";
import { colors, radii, fonts, spacing } from "./theme";

interface Props extends TextInputProps {
  label?: string;
}

export default function Input({ label, style, ...props }: Props) {
  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.textMuted}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing.lg,
    borderRadius: radii.md,
    fontSize: fonts.body,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
