import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

export const REVENUECAT_ENTITLEMENT_ID = 'parent_access';

const ANDROID_API_KEY = Constants.expoConfig?.extra?.revenueCatAndroidApiKey ?? '';

export function isRevenueCatAvailable(): boolean {
  return Platform.OS === 'android' && ANDROID_API_KEY.startsWith('goog_');
}

export async function configureRevenueCat(appUserId: string): Promise<void> {
  if (!isRevenueCatAvailable()) {
    throw new Error('Google Play subscriptions are not configured on this device.');
  }

  const isConfigured = await Purchases.isConfigured();
  if (!isConfigured) {
    Purchases.configure({ apiKey: ANDROID_API_KEY, appUserID: appUserId });
    return;
  }

  const currentUserId = await Purchases.getAppUserID();
  if (currentUserId !== appUserId) {
    await Purchases.logIn(appUserId);
  }
}

export function hasRevenueCatAccess(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID]?.isActive === true;
}

export async function getMonthlyParentAccessPackage(
  appUserId: string,
): Promise<PurchasesPackage> {
  await configureRevenueCat(appUserId);
  const offerings = await Purchases.getOfferings();
  const current = offerings.current ?? offerings.all.default;
  const monthly = current?.monthly ?? current?.availablePackages.find(
    (item) => item.identifier === '$rc_monthly',
  );

  if (!monthly) {
    throw new Error('The ClassPulse monthly subscription is not available yet.');
  }

  return monthly;
}

export async function purchaseMonthlyParentAccess(
  appUserId: string,
  monthlyPackage?: PurchasesPackage,
): Promise<CustomerInfo> {
  const selectedPackage = monthlyPackage ?? await getMonthlyParentAccessPackage(appUserId);
  await configureRevenueCat(appUserId);
  const result = await Purchases.purchasePackage(selectedPackage);
  return result.customerInfo;
}

export async function restoreParentAccess(appUserId: string): Promise<CustomerInfo> {
  await configureRevenueCat(appUserId);
  return Purchases.restorePurchases();
}

export async function getParentCustomerInfo(appUserId: string): Promise<CustomerInfo> {
  await configureRevenueCat(appUserId);
  return Purchases.getCustomerInfo();
}

export async function logOutRevenueCat(): Promise<void> {
  if (!isRevenueCatAvailable() || !(await Purchases.isConfigured())) return;
  await Purchases.logOut();
}
