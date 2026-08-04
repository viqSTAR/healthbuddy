import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

/**
 * The design system specifies Inter exclusively, with hierarchy carried by
 * weight rather than size. All five weights are loaded up front because the
 * 10px caption style depends on Medium being available immediately.
 */
export const useAppFonts = () =>
  useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
