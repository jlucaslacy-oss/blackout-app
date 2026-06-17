import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { colors, fonts } from "./theme";

interface Props {
  expiresAt: string;
}

function format(ms: number): string {
  if (ms <= 0) return "Terminada";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TimeLeft({ expiresAt }: Props) {
  const [remaining, setRemaining] = useState(
    new Date(expiresAt).getTime() - Date.now()
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(new Date(expiresAt).getTime() - Date.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const expired = remaining <= 0;

  return (
    <Text style={[styles.text, expired && styles.expired]}>
      {format(remaining)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.accent,
    fontSize: fonts.caption,
    fontWeight: "700",
  },
  expired: {
    color: colors.textDim,
  },
});
