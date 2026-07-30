import { ScrollView, Text, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, fonts, radii } from "../components/theme";

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Text style={styles.updated}>Last updated: June 2026</Text>

        <Text style={styles.heading}>1. Information We Collect</Text>
        <Text style={styles.body}>
          We collect the information you provide when creating your account (username, profile photo, bio) and the content you share (photos, comments). We also collect location data when you create or join a party.
        </Text>

        <Text style={styles.heading}>2. How We Use Your Information</Text>
        <Text style={styles.body}>
          We use your information to operate the app: show nearby parties, share content with your followers, and enable interaction between users. We do not sell your personal information to third parties.
        </Text>

        <Text style={styles.heading}>3. Sharing Information</Text>
        <Text style={styles.body}>
          Your username, profile photo, and bio are visible to other users. Photos from public parties are visible to all attendees. Feed photos are only visible to your accepted followers.
        </Text>

        <Text style={styles.heading}>4. Storage and Security</Text>
        <Text style={styles.body}>
          Your information is stored securely on Supabase servers. Party photos are automatically deleted when the party expires. You can delete your account and all your data at any time from settings.
        </Text>

        <Text style={styles.heading}>5. Your Rights</Text>
        <Text style={styles.body}>
          You can edit or delete your profile, block users, and delete your entire account. When you delete your account, all your data is permanently removed.
        </Text>

        <Text style={styles.heading}>6. Location</Text>
        <Text style={styles.body}>
          We use your location only to show you nearby parties on the map. We do not track your location in the background. You can revoke location permission at any time from your device settings.
        </Text>

        <Text style={styles.heading}>7. Contact</Text>
        <Text style={styles.body}>
          If you have questions about this privacy policy, contact us at jlucaslacy@gmail.com.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
  },
  content: { flex: 1 },
  contentInner: {
    padding: spacing.xl,
    paddingBottom: 60,
  },
  updated: {
    color: colors.textDim,
    fontSize: fonts.caption,
    marginBottom: spacing.xl,
  },
  heading: {
    color: colors.text,
    fontSize: fonts.body,
    fontWeight: "700",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.textSecondary,
    fontSize: fonts.small,
    lineHeight: 22,
  },
});
