import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';

const LOGO_BUCKET = 'school-logos';

interface SchoolLogoProps {
  logoUrl?: string | null;
  schoolName: string;
  size?: number;
}

export default function SchoolLogo({ logoUrl, schoolName, size = 40 }: SchoolLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const imageUrl = useMemo(() => {
    if (!logoUrl) return null;
    if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
    return supabase.storage.from(LOGO_BUCKET).getPublicUrl(logoUrl).data.publicUrl;
  }, [logoUrl]);

  return (
    <View
      style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityLabel={`${schoolName} logo`}
    >
      {imageUrl && !failed ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons name="school" size={Math.round(size * 0.52)} color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
