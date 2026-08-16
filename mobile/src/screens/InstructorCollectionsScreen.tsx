import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GridBackground from '../components/GridBackground';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

type CollectionStudent = {
  id: string;
  first_name: string;
  last_name: string;
  lrn: string;
  section?: { name: string; grade_level: string } | null;
  parents?: { guardian_name: string }[];
};

type Payment = {
  id: string;
  student_id: string;
  status: 'paid' | 'waived' | 'refunded';
  amount_paid: number;
  collected_at: string | null;
};

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

const BILLING_MONTH = currentBillingMonth();
const MONTH_LABEL = new Date(`${BILLING_MONTH}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

export default function InstructorCollectionsScreen({ navigation }: any) {
  const { instructorUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [students, setStudents] = useState<CollectionStudent[]>([]);
  const [payments, setPayments] = useState<Record<string, Payment>>({});
  const [googlePlayStudents, setGooglePlayStudents] = useState<Set<string>>(new Set());
  const [monthlyPrice, setMonthlyPrice] = useState(20);
  const [graceDays, setGraceDays] = useState(5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  const loadCollections = useCallback(async () => {
    if (!instructorUser?.id || !instructorUser.school_id) return;
    try {
      const sectionsResult = await supabase
        .from('sections')
        .select('id')
        .eq('school_id', instructorUser.school_id)
        .eq('adviser_id', instructorUser.id);
      if (sectionsResult.error) throw sectionsResult.error;
      const sectionIds = (sectionsResult.data ?? []).map((section) => section.id);
      if (sectionIds.length === 0) {
        setStudents([]);
        setPayments({});
        setGooglePlayStudents(new Set());
        return;
      }

      const [studentsResult, paymentsResult, settingsResult, googlePlayResult] = await Promise.all([
        supabase
          .from('students')
          .select('id, first_name, last_name, lrn, section:sections(name, grade_level), parents(guardian_name)')
          .eq('school_id', instructorUser.school_id)
          .in('section_id', sectionIds)
          .order('last_name'),
        supabase
          .from('parent_access_payments')
          .select('id, student_id, status, amount_paid, collected_at')
          .eq('school_id', instructorUser.school_id)
          .eq('billing_month', BILLING_MONTH),
        supabase
          .from('parent_access_billing_settings')
          .select('monthly_price, grace_days')
          .eq('school_id', instructorUser.school_id)
          .maybeSingle(),
        supabase.rpc('get_adviser_google_play_access'),
      ]);
      if (studentsResult.error) throw studentsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (googlePlayResult.error) throw googlePlayResult.error;

      setStudents((studentsResult.data ?? []) as unknown as CollectionStudent[]);
      setPayments(Object.fromEntries(((paymentsResult.data ?? []) as Payment[]).map((payment) => [payment.student_id, payment])));
      setGooglePlayStudents(new Set(
        ((googlePlayResult.data ?? []) as Array<{ student_id: string }>).map((row) => row.student_id),
      ));
      if (settingsResult.data) {
        setMonthlyPrice(Number(settingsResult.data.monthly_price));
        setGraceDays(settingsResult.data.grace_days);
      }
    } catch (error: any) {
      Alert.alert('Unable to load collections', error?.message || 'Please check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [instructorUser?.id, instructorUser?.school_id]);

  useEffect(() => {
    void loadCollections();
    const unsubscribe = navigation.addListener('focus', () => void loadCollections());
    return unsubscribe;
  }, [loadCollections, navigation]);

  const visibleStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      `${student.first_name} ${student.last_name} ${student.lrn} ${student.parents?.[0]?.guardian_name ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [search, students]);

  const paidCount = students.filter((student) => payments[student.id]?.status === 'paid').length;
  const waivedCount = students.filter((student) => payments[student.id]?.status === 'waived').length;
  const googlePlayCount = students.filter((student) => {
    const paymentStatus = payments[student.id]?.status;
    return googlePlayStudents.has(student.id) && paymentStatus !== 'paid' && paymentStatus !== 'waived';
  }).length;
  const collected = students.reduce((sum, student) => sum + (payments[student.id]?.status === 'paid' ? Number(payments[student.id].amount_paid) : 0), 0);

  async function savePayment(student: CollectionStudent, action: 'paid' | 'waived') {
    setUpdating((current) => new Set(current).add(student.id));
    const { error } = await supabase.rpc('record_parent_access_payment', {
      p_student_id: student.id,
      p_billing_month: BILLING_MONTH,
      p_action: action,
      p_amount: action === 'paid' ? monthlyPrice : 0,
      p_payment_reference: null,
      p_notes: action === 'waived' ? 'Waived by adviser from mobile' : null,
    });
    setUpdating((current) => {
      const next = new Set(current);
      next.delete(student.id);
      return next;
    });
    if (error) {
      Alert.alert('Could not record payment', error.message);
      return;
    }
    await loadCollections();
  }

  function confirmPaid(student: CollectionStudent) {
    Alert.alert(
      'Confirm cash payment',
      `Record ₱${monthlyPrice.toLocaleString('en-PH')} received from ${student.first_name} ${student.last_name}'s guardian for ${MONTH_LABEL}?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark Paid', onPress: () => void savePayment(student, 'paid') }],
    );
  }

  function confirmWaive(student: CollectionStudent) {
    Alert.alert(
      'Waive monthly payment?',
      `This will activate parent access for ${student.first_name} ${student.last_name} without adding income.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Waive', onPress: () => void savePayment(student, 'waived') }],
    );
  }

  return (
    <GridBackground>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}><Text style={styles.headerTitle}>Parent Collections</Text><Text style={styles.headerSubtitle}>{MONTH_LABEL}</Text></View>
        </View>
      </View>

      {loading ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View> : (
        <FlatList
          data={visibleStudents}
          keyExtractor={(student) => student.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadCollections(); }} colors={[colors.primary]} />}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryMain}><Text style={styles.summaryLabel}>Cash collected</Text><Text style={styles.summaryValue}>₱{collected.toLocaleString('en-PH')}</Text></View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryCounts}>
                  <SummaryItem label="Paid" value={paidCount} color={colors.success} />
                  <SummaryItem label="Google Play" value={googlePlayCount} color={colors.primary} />
                  <SummaryItem label="Unpaid" value={Math.max(0, students.length - paidCount - waivedCount - googlePlayCount)} color={colors.warning} />
                  <SummaryItem label="Waived" value={waivedCount} color={colors.secondary} />
                </View>
              </View>
              <View style={styles.policyNote}><Ionicons name="information-circle-outline" size={17} color={colors.primary} /><Text style={styles.policyText}>₱{monthlyPrice.toLocaleString('en-PH')} per student · {graceDays}-day grace period. Unpaid access turns off automatically after grace.</Text></View>
              <View style={styles.searchBox}><Ionicons name="search" size={18} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="Search student or guardian" placeholderTextColor="#94a3b8" style={styles.searchInput} /></View>
            </>
          }
          renderItem={({ item: student }) => {
            const payment = payments[student.id];
            const hasGooglePlay = googlePlayStudents.has(student.id)
              && payment?.status !== 'paid'
              && payment?.status !== 'waived';
            const isUpdating = updating.has(student.id);
            return (
              <View style={styles.studentCard}>
                <View style={styles.studentTop}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{student.first_name[0]}{student.last_name[0]}</Text></View>
                  <View style={styles.studentCopy}><Text style={styles.studentName}>{student.last_name}, {student.first_name}</Text><Text style={styles.studentMeta}>{student.section ? `${student.section.grade_level} · ${student.section.name}` : student.lrn}</Text><Text style={styles.guardian}>{student.parents?.[0]?.guardian_name || 'No guardian recorded'}</Text></View>
                  <PaymentBadge payment={payment} graceDays={graceDays} hasGooglePlay={hasGooglePlay} />
                </View>
                {hasGooglePlay ? <Text style={styles.recordedText}>Google Play subscription · Access On</Text> : payment?.status === 'paid' ? <Text style={styles.recordedText}>Paid {payment.collected_at ? new Date(payment.collected_at).toLocaleDateString('en-PH') : ''} · Access On</Text> : (
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.paidButton, isUpdating && styles.disabled]} onPress={() => confirmPaid(student)} disabled={isUpdating}><Ionicons name="cash-outline" size={17} color="#fff" /><Text style={styles.paidButtonText}>Mark ₱{monthlyPrice.toLocaleString('en-PH')} Paid</Text></TouchableOpacity>
                    {!payment ? <TouchableOpacity style={[styles.waiveButton, isUpdating && styles.disabled]} onPress={() => confirmWaive(student)} disabled={isUpdating}><Text style={styles.waiveButtonText}>Waive</Text></TouchableOpacity> : null}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={34} color={colors.textMuted} /><Text style={styles.emptyText}>{search ? 'No matching students' : 'No advisory students found'}</Text></View>}
        />
      )}
    </GridBackground>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={styles.summaryItem}><Text style={[styles.summaryCount, { color }]}>{value}</Text><Text style={styles.summaryItemLabel}>{label}</Text></View>;
}

function PaymentBadge({ payment, graceDays, hasGooglePlay }: { payment?: Payment; graceDays: number; hasGooglePlay: boolean }) {
  if (hasGooglePlay) return <View style={[styles.badge, styles.badgeGoogle]}><Text style={[styles.badgeText, { color: colors.primary }]}>Google Play</Text></View>;
  if (payment?.status === 'paid') return <View style={[styles.badge, styles.badgePaid]}><Text style={[styles.badgeText, { color: colors.success }]}>Paid</Text></View>;
  if (payment?.status === 'waived') return <View style={[styles.badge, styles.badgeWaived]}><Text style={[styles.badgeText, { color: colors.secondary }]}>Waived</Text></View>;
  const grace = new Date().getDate() <= graceDays;
  return <View style={[styles.badge, grace ? styles.badgeGrace : styles.badgeOff]}><Text style={[styles.badgeText, { color: grace ? colors.warning : colors.textMuted }]}>{grace ? 'Grace' : 'Access Off'}</Text></View>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginRight: 8, borderRadius: 19, backgroundColor: colors.surfaceSoft },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  headerSubtitle: { marginTop: 1, fontSize: 12, color: colors.textMuted },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 15, paddingBottom: 32 },
  summaryCard: { padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  summaryMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  summaryValue: { fontSize: 25, fontWeight: '800', color: colors.primaryDark },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginVertical: 14, backgroundColor: colors.border },
  summaryCounts: { flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryCount: { fontSize: 18, fontWeight: '800' },
  summaryItemLabel: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  policyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#f0fdfa' },
  policyText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.primaryDark },
  searchBox: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  searchInput: { flex: 1, paddingHorizontal: 9, paddingVertical: 11, fontSize: 14, color: colors.text },
  studentCard: { marginBottom: 10, padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  studentTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 10, borderRadius: 20, backgroundColor: '#ccfbf1' },
  avatarText: { fontSize: 13, fontWeight: '800', color: colors.primaryDark },
  studentCopy: { flex: 1, minWidth: 0 },
  studentName: { fontSize: 14, fontWeight: '700', color: colors.text },
  studentMeta: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  guardian: { marginTop: 2, fontSize: 11, color: '#94a3b8' },
  badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  badgePaid: { backgroundColor: '#ecfdf3' },
  badgeGoogle: { backgroundColor: '#f0fdfa' },
  badgeWaived: { backgroundColor: '#eff6ff' },
  badgeGrace: { backgroundColor: '#fffbeb' },
  badgeOff: { backgroundColor: colors.surfaceSoft },
  badgeText: { fontSize: 10, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  paidButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primaryDark },
  paidButtonText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  waiveButton: { paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  waiveButtonText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  disabled: { opacity: 0.5 },
  recordedText: { marginTop: 10, textAlign: 'right', fontSize: 10, color: colors.textMuted },
  empty: { alignItems: 'center', paddingTop: 45 },
  emptyText: { marginTop: 10, fontSize: 13, color: colors.textMuted },
});
