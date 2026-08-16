import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors } from '../theme/colors';

interface GridBackgroundProps {
  children: React.ReactNode;
  step?: number;
}

export default function GridBackground({ children, step = 44 }: GridBackgroundProps) {
  const { width, height } = useWindowDimensions();

  const verticalLines = useMemo(
    () => Array.from({ length: Math.ceil(width / step) + 1 }, (_, index) => index * step),
    [step, width]
  );

  const horizontalLines = useMemo(
    () => Array.from({ length: Math.ceil(height / step) + 2 }, (_, index) => index * step),
    [height, step]
  );

  return (
    <View style={styles.root}>
      <View style={styles.baseLayer} />

      <View pointerEvents="none" style={styles.gridLayer}>
        {verticalLines.map((left) => (
          <View key={`v-${left}`} style={[styles.verticalLine, { left }]} />
        ))}

        {horizontalLines.map((top) => (
          <View key={`h-${top}`} style={[styles.horizontalLine, { top }]} />
        ))}

        <View style={styles.glowTopLeft} />
        <View style={styles.glowBottomRight} />
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  baseLayer: {
    position: 'absolute',
    inset: 0,
    backgroundColor: colors.background,
  },
  gridLayer: {
    position: 'absolute',
    inset: 0,
  },
  verticalLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(15,118,110,0.08)',
  },
  horizontalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(3,105,161,0.07)',
  },
  glowTopLeft: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(45,212,191,0.18)',
  },
  glowBottomRight: {
    position: 'absolute',
    right: -90,
    bottom: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(3,105,161,0.14)',
  },
});
