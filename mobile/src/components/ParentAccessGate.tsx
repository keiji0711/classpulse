import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import GridBackground from './GridBackground';
import ChildSwitcher from './ChildSwitcher';
import {
  getMonthlyParentAccessPackage,
  getParentCustomerInfo,
  hasRevenueCatAccess,
  isRevenueCatAvailable,
  purchaseMonthlyParentAccess,
  restoreParentAccess,
} from '../lib/revenueCat';

export default function ParentAccessGate({ children }: { children?: React.ReactNode }) {
  const { hasAccess, role, session, logout, refreshParentAccess, syncGooglePlayAccess } = useAuth();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [purchaseAction, setPurchaseAction] = useState<'subscribe' | 'restore' | null>(null);

  const billingAppUserId = session?.billing_app_user_id;
  const googlePlayAvailable = Boolean(billingAppUserId && isRevenueCatAvailable());

  useEffect(() => {
    if (!googlePlayAvailable || !billingAppUserId || hasAccess) return;
    let cancelled = false;
    setLoadingPlan(true);
    getMonthlyParentAccessPackage(billingAppUserId)
      .then((plan) => {
        if (!cancelled) setMonthlyPackage(plan);
      })
      .catch(() => {
        if (!cancelled) setMonthlyPackage(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billingAppUserId, googlePlayAvailable, hasAccess]);

  async function finishGooglePlayVerification(successMessage: string) {
    const googlePlayActive = await syncGooglePlayAccess();
    if (!googlePlayActive) {
      Alert.alert(
        'Purchase received',
        'Google Play is still confirming your access. Please tap Check Access Again in a moment.',
      );
      return;
    }
    Alert.alert('Access activated', successMessage);
  }

  async function subscribe() {
    if (!billingAppUserId || purchaseAction) return;
    setPurchaseAction('subscribe');
    try {
      const customerInfo = await purchaseMonthlyParentAccess(billingAppUserId, monthlyPackage ?? undefined);
      if (!hasRevenueCatAccess(customerInfo)) {
        throw new Error('Google Play did not return an active subscription.');
      }
      await finishGooglePlayVerification('Your ClassPulse parent access is now active.');
    } catch (error) {
      const purchaseError = error as { userCancelled?: boolean; message?: string };
      if (!purchaseError.userCancelled) {
        Alert.alert(
          'Subscription not completed',
          purchaseError.message || 'Please try again using Google Play.',
        );
      }
    } finally {
      setPurchaseAction(null);
    }
  }

  async function restore() {
    if (!billingAppUserId || purchaseAction) return;
    setPurchaseAction('restore');
    try {
      const customerInfo = await restoreParentAccess(billingAppUserId);
      if (!hasRevenueCatAccess(customerInfo)) {
        Alert.alert('No active subscription', 'Google Play did not find an active ClassPulse subscription for this account.');
        return;
      }
      await finishGooglePlayVerification('Your Google Play subscription has been restored.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Could not restore purchases', message);
    } finally {
      setPurchaseAction(null);
    }
  }

  async function checkAccess() {
    setChecking(true);
    try {
      if (billingAppUserId && googlePlayAvailable) {
        await getParentCustomerInfo(billingAppUserId).catch(() => null);
        await syncGooglePlayAccess();
      }
      await refreshParentAccess();
    } finally {
      setChecking(false);
    }
  }

  if (role !== 'parent' || hasAccess) {
    return <>{children}</>;
  }

  return (
    <GridBackground>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={48} color={colors.primary} />
        </View>
        <Text style={styles.title}>Parent Access Inactive</Text>
        <Text style={styles.subtitle}>
          Subscribe securely through Google Play to view attendance, grades, exam scores, announcements, and school updates.
        </Text>
        {Platform.OS === 'android' ? (
          <View style={styles.subscriptionCard}>
            <View style={styles.subscriptionHeader}>
              <View style={styles.playIcon}>
                <Ionicons name="logo-google-playstore" size={25} color="#fff" />
              </View>
              <View style={styles.subscriptionCopy}>
                <Text style={styles.subscriptionTitle}>ClassPulse Parent Access</Text>
                <Text style={styles.subscriptionPrice}>
                  {monthlyPackage?.product.priceString
                    ? `${monthlyPackage.product.priceString} per month`
                    : loadingPlan ? 'Loading Google Play price...' : 'Monthly subscription'}
                </Text>
              </View>
            </View>
            <Text style={styles.renewalText}>Automatically renews monthly until cancelled in Google Play.</Text>
            <TouchableOpacity
              style={[styles.subscribeButton, (!monthlyPackage || purchaseAction !== null) && styles.disabled]}
              onPress={() => void subscribe()}
              disabled={!monthlyPackage || purchaseAction !== null}
              activeOpacity={0.85}
            >
              {purchaseAction === 'subscribe'
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="card-outline" size={20} color="#fff" />}
              <Text style={styles.buttonText}>
                {purchaseAction === 'subscribe' ? 'Opening Google Play...' : 'Subscribe with Google Play'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restoreButton}
              onPress={() => void restore()}
              disabled={!googlePlayAvailable || purchaseAction !== null}
              activeOpacity={0.8}
            >
              {purchaseAction === 'restore' && <ActivityIndicator size="small" color={colors.primary} />}
              <Text style={styles.restoreText}>Restore Purchases</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <Text style={styles.manualHint}>
          If your school has already activated access for you, check again below.
        </Text>
        {session?.siblings?.length ? (
          <View style={styles.switcherCard}>
            <View style={styles.switcherCopy}>
              <Text style={styles.switcherTitle}>Have another child?</Text>
              <Text style={styles.switcherText}>Switch profiles without signing out.</Text>
            </View>
            <ChildSwitcher />
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.button}
          onPress={() => void checkAccess()}
          disabled={checking}
          activeOpacity={0.8}
        >
          {checking ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={20} color="#fff" />}
          <Text style={styles.buttonText}>{checking ? 'Checking...' : 'Check Access Again'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signOutButton} onPress={() => void logout()} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(15, 118, 110, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 18,
  },
  subscriptionCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscriptionCopy: {
    flex: 1,
  },
  subscriptionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  subscriptionPrice: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  renewalText: {
    marginTop: 12,
    marginBottom: 14,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  subscribeButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 13,
    paddingHorizontal: 18,
  },
  disabled: {
    opacity: 0.55,
  },
  restoreButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 6,
  },
  restoreText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  manualHint: {
    width: '100%',
    maxWidth: 420,
    marginBottom: 14,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
  },
  switcherCard: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
  },
  switcherCopy: {
    flex: 1,
  },
  switcherTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  switcherText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: colors.textMuted,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
});
