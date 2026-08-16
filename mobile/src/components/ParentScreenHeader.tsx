import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import ChildSwitcher from './ChildSwitcher';
import SchoolLogo from './SchoolLogo';

interface ParentScreenHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export default function ParentScreenHeader({ eyebrow, title, description }: ParentScreenHeaderProps) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerTopRow}>
        <View style={styles.schoolBrand}>
          <SchoolLogo
            logoUrl={session?.school.logo_url}
            schoolName={session?.school.name ?? 'School'}
            size={40}
          />
          <View style={styles.schoolBrandText}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.schoolName} numberOfLines={1}>{session?.school.name ?? 'School'}</Text>
          </View>
        </View>
        <ChildSwitcher />
      </View>

      <View style={styles.headerIntro}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {description} {session?.student.first_name ?? 'your learner'}
          </Text>
        </View>
        <View style={styles.secureBadge}>
          <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
          <Text style={styles.secureText}>Private</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  schoolBrand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, marginRight: 10 },
  schoolBrandText: { flex: 1 },
  eyebrow: { fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 1, marginBottom: 1 },
  schoolName: { fontSize: 14, fontWeight: '800', color: colors.text },
  headerIntro: { marginTop: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titleWrap: { flex: 1, paddingRight: 10 },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '900', color: colors.text, letterSpacing: -0.7 },
  subtitle: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#d1fae5',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  secureText: { fontSize: 9, fontWeight: '900', color: colors.primary },
});
