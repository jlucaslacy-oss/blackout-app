import { useState } from "react";
import { TextInput, StyleSheet, TextInputProps, View, Text } from "react-native";
import { colors, radii, fonts, spacing } from "./theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export default function Input({ label, style, error, onFocus, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  inputFocused: {
    borderColor: colors.accent,
  },
  inputError: {
    borderColor: "rgba(239,68,68,0.7)",
  },
  errorText: {
    color: colors.error,
    fontSize: fonts.caption,
    marginTop: spacing.xs,
  },
});
