import type { SubscriptionEntitlements } from '../types';

let currentEntitlements: SubscriptionEntitlements | null = null;

export function setRuntimeEntitlements(entitlements: SubscriptionEntitlements | null) {
  currentEntitlements = entitlements;
}

export function isRuntimeFeatureEnabled(featureKey: string) {
  void currentEntitlements;
  void featureKey;
  return true;
}
