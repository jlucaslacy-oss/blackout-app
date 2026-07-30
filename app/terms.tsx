import { ScrollView, Text, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, fonts } from "../components/theme";

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Use</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Text style={styles.updated}>Last updated: June 2026</Text>

        <Text style={styles.body}>
          By using Blackout ("the app"), you accept these terms of use. If you do not agree, do not use the app.
        </Text>

        <Text style={styles.heading}>1. Eligibility</Text>
        <Text style={styles.body}>
          You must be at least 18 years old to create an account and use Blackout. By signing up, you confirm that you meet this requirement.
        </Text>

        <Text style={styles.heading}>2. Your Account</Text>
        <Text style={styles.body}>
          You are responsible for maintaining the security of your account. Do not share your access with third parties. We reserve the right to suspend or delete accounts that violate these terms.
        </Text>

        <Text style={styles.heading}>3. User Content</Text>
        <Text style={styles.body}>
          You are responsible for the content you post. By posting content, you grant us a non-exclusive license to display it within the app. You retain all rights to your content.
        </Text>

        <Text style={styles.heading}>4. Prohibited Conduct</Text>
        <Text style={styles.body}>
          You may not use Blackout to: post illegal, violent, pornographic, or hate-promoting content; harass or intimidate other users; impersonate another person; post copyrighted content; distribute spam or malware; use the app if you are under 18; or use bots or automated tools.
        </Text>

        <Text style={styles.heading}>5. Content Moderation</Text>
        <Text style={styles.body}>
          We reserve the right to review, moderate, and remove content that violates these terms or is reported by other users.
        </Text>

        <Text style={styles.heading}>6. Parties and Location</Text>
        <Text style={styles.body}>
          Parties are ephemeral events created by users. Blackout does not organize, sponsor, or take responsibility for parties or what happens at them. You attend at your own risk.
        </Text>

        <Text style={styles.heading}>7. Account Deletion</Text>
        <Text style={styles.body}>
          You can delete your account at any time from the app settings. All your data will be permanently deleted within 30 days.
        </Text>

        <Text style={styles.heading}>8. Limitation of Liability</Text>
        <Text style={styles.body}>
          Blackout is provided "as is" without warranties. We are not responsible for damages resulting from the use of the app.
        </Text>

        <Text style={styles.heading}>9. Contact</Text>
        <Text style={styles.body}>
          For questions about these terms, contact jlucaslacy@gmail.com.
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
