export const colors = {
  background: "#0A0A0A",
  surface: "#1A1A1A",
  surfaceLight: "#222",
  border: "#333",
  accent: "#FFFFFF",
  accentDark: "#CCCCCC",
  text: "#FFFFFF",
  textSecondary: "#AAAAAA",
  textMuted: "#888888",
  textDim: "#666666",
  textDimmer: "#444444",
  textFade: "rgba(255,255,255,0.18)",
  error: "#ef4444",
  success: "#22c55e",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export const fonts = {
  caption: 12,
  small: 14,
  body: 16,
  title: 24,
  hero: 40,
} as const;
