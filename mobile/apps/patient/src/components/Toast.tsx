import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Icon, Text, colors, radius, spacing, elevation } from '@healthbuddy/shared';

/**
 * A brief, non-blocking confirmation.
 *
 * Deliberately not an Alert: adding something to a basket should not stop what
 * you are doing to demand a tap. The toast says what happened and gets out of
 * the way, which is the only reason it is safe to fire on every add.
 */

type ToastTone = 'success' | 'error';

interface ToastState {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastState | null>(null);

const VISIBLE_MS = 1900;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>('success');

  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (next: string, nextTone: ToastTone = 'success') => {
      setMessage(next);
      setTone(nextTone);

      // Restart rather than queue. Tapping "add" four times quickly should leave
      // one toast reading the latest count, not four toasts in a row.
      if (timer.current) clearTimeout(timer.current);

      opacity.setValue(0);
      lift.setValue(12);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(lift, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();

      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(
          ({ finished }) => {
            if (finished) setMessage(null);
          }
        );
      }, VISIBLE_MS);
    },
    [opacity, lift]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message ? (
        // pointerEvents none: the toast must never swallow a tap meant for the
        // button underneath it.
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { opacity, transform: [{ translateY: lift }] }]}
        >
          <View style={[styles.toast, tone === 'error' && styles.toastError]}>
            <Icon
              name={tone === 'error' ? 'error' : 'check_circle'}
              size={16}
              color={colors.surfaceContainerLowest}
            />
            <Text variant="captionSm" weight="medium" color={colors.surfaceContainerLowest}>
              {message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastState => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // Clear of the cart bar and the tab bar, which both sit lower.
    bottom: 148,
    left: spacing.insetPage,
    right: spacing.insetPage,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.base + 2,
    paddingHorizontal: spacing.insetCard + 2,
    borderRadius: radius.full,
    backgroundColor: colors.headingDark,
    ...elevation,
  },
  toastError: { backgroundColor: colors.error },
});
