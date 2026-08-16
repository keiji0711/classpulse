import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';

export default function ChildSwitcher() {
  const { session, switchChild } = useAuth();
  const [visible, setVisible] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (!session || !session.siblings || session.siblings.length === 0) {
    return null;
  }

  const currentName = `${session.student.first_name} ${session.student.last_name.charAt(0)}.`;

  async function handleSwitch(childId: string) {
    setSwitching(true);
    setVisible(false);
    try {
      await switchChild(childId);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.pill}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
        disabled={switching}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {session.student.first_name.charAt(0)}
          </Text>
        </View>
        <Text style={styles.pillName} numberOfLines={1}>
          {switching ? 'Switching...' : currentName}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.dropdown}>
            <Text style={styles.dropdownLabel}>Switch child</Text>

            {/* Current child */}
            <View style={[styles.childRow, styles.childRowActive]}>
              <View style={[styles.childAvatar, styles.childAvatarActive]}>
                <Text style={styles.childAvatarTextActive}>
                  {session.student.first_name.charAt(0)}
                </Text>
              </View>
              <View style={styles.childInfo}>
                <Text style={[styles.childName, styles.childNameActive]}>
                  {session.student.first_name} {session.student.last_name}
                </Text>
                <Text style={styles.childLrn}>LRN: {session.student.lrn}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            </View>

            {/* Siblings */}
            {session.siblings.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childRow}
                onPress={() => handleSwitch(child.id)}
                activeOpacity={0.6}
              >
                <View style={styles.childAvatar}>
                  <Text style={styles.childAvatarText}>
                    {child.first_name.charAt(0)}
                  </Text>
                </View>
                <View style={styles.childInfo}>
                  <Text style={styles.childName}>
                    {child.first_name} {child.last_name}
                  </Text>
                  <Text style={styles.childLrn}>LRN: {child.lrn}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 10,
    gap: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  pillName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    maxWidth: 100,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 100 : 80,
    paddingRight: 16,
  },
  dropdown: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    minWidth: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  dropdownLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 10,
  },
  childRowActive: {
    backgroundColor: '#f0fdfa',
  },
  childAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  childAvatarActive: {
    backgroundColor: colors.primary,
  },
  childAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  childAvatarTextActive: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  childInfo: {
    flex: 1,
  },
  childName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  childNameActive: {
    color: colors.primary,
  },
  childLrn: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
});
