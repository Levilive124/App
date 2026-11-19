import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

type Props = {
  /** visible heights in px, ascending */
  snapPoints: number[];
  index: number;
  onIndexChange: (i: number) => void;
  header?: React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
};

/** Draggable card that snaps to fixed heights, like the sheets in the big map apps. */
export function BottomSheet({ snapPoints, index, onIndexChange, header, children, style }: Props) {
  const t = useTheme();
  const { height: winH } = useWindowDimensions();
  const maxH = Math.min(winH, snapPoints[snapPoints.length - 1]);
  const clampIndex = Math.max(0, Math.min(index, snapPoints.length - 1));
  const translate = useRef(new Animated.Value(maxH - snapPoints[clampIndex])).current;
  const current = useRef(maxH - snapPoints[clampIndex]);
  const dragStart = useRef(0);
  const latest = useRef({ snapPoints, maxH, onIndexChange });
  latest.current = { snapPoints, maxH, onIndexChange };

  useEffect(() => {
    const id = translate.addListener(({ value }) => (current.current = value));
    return () => translate.removeListener(id);
  }, [translate]);

  useEffect(() => {
    Animated.spring(translate, {
      toValue: maxH - snapPoints[clampIndex],
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
      mass: 0.8,
    }).start();
  }, [clampIndex, maxH, snapPoints, translate]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          translate.stopAnimation();
          dragStart.current = current.current;
          translate.setOffset(dragStart.current);
          translate.setValue(0);
        },
        onPanResponderMove: (_, g) => {
          const { maxH, snapPoints } = latest.current;
          const minT = 0;
          const maxT = maxH - snapPoints[0];
          const base = dragStart.current;
          const next = Math.max(minT - 30, Math.min(maxT + 30, base + g.dy));
          translate.setValue(next - base);
        },
        onPanResponderRelease: (_, g) => {
          translate.flattenOffset();
          const { maxH, snapPoints, onIndexChange } = latest.current;
          const projected = current.current + g.vy * 120;
          let best = 0;
          snapPoints.forEach((s, i) => {
            if (Math.abs(maxH - s - projected) < Math.abs(maxH - snapPoints[best] - projected)) best = i;
          });
          Animated.spring(translate, {
            toValue: maxH - snapPoints[best],
            useNativeDriver: true,
            velocity: g.vy,
            damping: 22,
            stiffness: 220,
            mass: 0.8,
          }).start();
          onIndexChange(best);
        },
      }),
    [translate],
  );

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: maxH, backgroundColor: t.sheet, shadowColor: t.shadow, transform: [{ translateY: translate }] },
        style,
      ]}
    >
      <View {...pan.panHandlers}>
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: t.border }]} />
        </View>
        {header}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 16,
    overflow: 'hidden',
  },
  handleWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 6 },
  handle: { width: 38, height: 5, borderRadius: 3 },
});
