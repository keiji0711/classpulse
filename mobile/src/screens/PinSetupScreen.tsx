import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, getAuthHeaders } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

const PIN_LENGTH = 4;

export default function PinSetupScreen() {
  const { session, confirmPinSetup } = useAuth();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [saving, setSaving] = useState(false);
  const confirmRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (pin.length !== PIN_LENGTH) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits.');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'The PINs do not match. Please try again.');
      setConfirmPin('');
      setStep('create');
      setPin('');
      return;
    }

    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/set-parent-pin`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ parent_id: session?.parent?.id, pin }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to set PIN');
      }

      confirmPinSetup();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to set PIN. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handlePinChange(text: string) {
    const cleaned = text.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setPin(cleaned);
    if (cleaned.length === PIN_LENGTH) {
      setStep('confirm');
      setTimeout(() => confirmRef.current?.focus(), 100);
    }
  }

  function handleConfirmChange(text: string) {
    const cleaned = text.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setConfirmPin(cleaned);
  }

  return (
    <GridBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={48} color={colors.primary} />
          </View>

          <Text style={styles.title}>Create Your PIN</Text>
          <Text style={styles.subtitle}>
            Set a 4-digit PIN to secure your child's grades and attendance data.
            You'll need this PIN every time you log in.
          </Text>

          {step === 'create' ? (
            <View style={styles.pinSection}>
              <Text style={styles.label}>Enter a 4-digit PIN</Text>
              <View style={styles.dotsRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View key={i} style={[styles.dot, pin.length > i && styles.dotFilled]} />
                ))}
              </View>
              <TextInput
                style={styles.hiddenInput}
                value={pin}
                onChangeText={handlePinChange}
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                autoFocus
                caretHidden
              />
            </View>
          ) : (
            <View style={styles.pinSection}>
              <Text style={styles.label}>Confirm your PIN</Text>
              <View style={styles.dotsRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View key={i} style={[styles.dot, confirmPin.length > i && styles.dotFilled]} />
                ))}
              </View>
              <TextInput
                ref={confirmRef}
                style={styles.hiddenInput}
                value={confirmPin}
                onChangeText={handleConfirmChange}
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                autoFocus
                caretHidden
              />
            </View>
          )}

          {step === 'confirm' && (
            <>
              <TouchableOpacity
                style={[styles.button, (saving || confirmPin.length < PIN_LENGTH) && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={saving || confirmPin.length < PIN_LENGTH}
                activeOpacity={0.7}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Set PIN</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => { setStep('create'); setPin(''); setConfirmPin(''); }}
              >
                <Text style={styles.retryText}>Start over</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    alignSelf: 'center',
    backgroundColor: 'rgba(79,70,229,0.1)',
    borderRadius: 28,
    padding: 20,
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 40,
  },
  pinSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  retryBtn: {
    alignSelf: 'center',
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
