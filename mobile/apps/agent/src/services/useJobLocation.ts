import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { reportJobLocation } from '@healthbuddy/shared';

/**
 * Reports where the rider is while a parcel is actually in their hands.
 *
 * Three deliberate limits:
 *
 * Foreground only. Background location needs a development build and a store
 * privacy declaration, and it tracks a person all day rather than a parcel for
 * an hour. Reporting stops the moment the app is backgrounded and resumes when
 * it comes forward, which is honest about what it is.
 *
 * Only while carrying. The caller passes a job id only when that job is out
 * for delivery — before collection and after hand-over there is no parcel to
 * follow, and the server refuses those reports anyway.
 *
 * Names resolved here, not on the server. `reverseGeocodeAsync` uses the OS
 * geocoder, so there is no third-party key and no per-report round trip. The
 * customer is shown these names; the coordinates go only to operations.
 */

/** Often enough to be useful, rarely enough not to eat a shift's battery. */
const EVERY_MS = 45_000;
/** Below this the reverse geocode is unlikely to name a different place. */
const MOVED_METRES = 120;

const metresBetween = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) => {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const useJobLocation = (jobId: string | null) => {
  const lastSent = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const reportOnce = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;

        const here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        // A parked scooter drifts by a few metres. Sending that would spend
        // battery and a request to tell the server nothing changed.
        if (lastSent.current && metresBetween(lastSent.current, here) < MOVED_METRES) return;

        let place: { street?: string; locality?: string; city?: string } = {};
        try {
          const [found] = await Location.reverseGeocodeAsync(here);
          if (found) {
            place = {
              ...(found.street ? { street: found.street } : {}),
              // `district` is the suburb or village on Android; `subregion`
              // is the nearest equivalent when it is absent.
              ...(found.district || found.subregion
                ? { locality: found.district ?? found.subregion ?? undefined }
                : {}),
              ...(found.city ? { city: found.city } : {}),
            };
          }
        } catch {
          // A position with no name is still worth sending — operations can
          // read a coordinate, and the customer simply sees no new place.
        }

        if (cancelled) return;
        await reportJobLocation(jobId, { ...here, ...place });
        lastSent.current = here;
      } catch {
        // A dropped report is not worth interrupting a delivery for. The next
        // one is along in under a minute.
      }
    };

    const start = () => {
      if (timer) return;
      void reportOnce();
      timer = setInterval(() => void reportOnce(), EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop()
    );

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [jobId]);
};
