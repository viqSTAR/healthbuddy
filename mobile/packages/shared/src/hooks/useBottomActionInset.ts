import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding for a control pinned to the bottom of the screen.
 *
 * Android reserves nothing below a gesture-navigation bar, so a floating cart
 * bar or a "Book appointment" footer sitting at `bottom: 0` with a comfortable
 * padding looks and behaves correctly there. iPhones since the X put a 34pt
 * home indicator in that space, and the system claims the gesture along with
 * it: a button drawn under it is both half-covered and hard to press, because
 * a touch starting there is read as a swipe up to the home screen.
 *
 * So the floor is whatever the design asked for, and the actual value is
 * whatever the device needs — identical on Android, correct on iOS.
 *
 * @param minimum the padding the design specifies, used where there is no inset
 */
export const useBottomActionInset = (minimum: number): number => {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, minimum);
};
