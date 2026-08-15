import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import {
  fetchAddresses,
  checkServiceability,
  useAuth,
  type Address,
  type Serviceability,
} from '@healthbuddy/shared';

/**
 * Where the patient is shopping from.
 *
 * One active location drives the whole app: which medicines are listed and at
 * what price, whether the store opens at all, which doctors can be seen in
 * person, which labs will collect a sample, and where an order is sent. Keeping
 * it here rather than passing a pincode down through screens is what stops two
 * parts of the app disagreeing about where the user is — a cart priced for one
 * area and checked out to another is the bug this shape exists to prevent.
 *
 * The active location is NOT the same thing as a saved address.
 *
 * Delivery apps open straight into a catalogue: they take the device position,
 * work out the pincode and start selling, and only ask for a full address when
 * something actually has to be delivered. Requiring a saved address first meant
 * a new patient — who by definition has none — opened the store to "Set your
 * delivery address" and an empty screen, which is a dead end on the first
 * launch. So a location can come from three places, in descending order of how
 * much we trust it:
 *
 *   address — a saved address the user picked. Has a street, so it can receive
 *             an order.
 *   manual  — a pincode the user typed. Enough to browse and price, not enough
 *             to deliver to.
 *   gps     — read from the device on launch. Same: browse now, collect the
 *             street at checkout.
 *
 * Anything that ships asks for a real address at the point of ordering; the
 * other two exist so the app is useful before that.
 */

export type LocationSource = 'address' | 'manual' | 'gps';

export interface ActiveLocation {
  pincode: string;
  city: string | null;
  state: string | null;
  /** The saved address behind this, when there is one. Null for gps/manual. */
  address: Address | null;
  source: LocationSource;
}

/** A pincode with no saved address behind it. */
interface DetectedLocation {
  pincode: string;
  city: string | null;
  state: string | null;
  latitude?: number;
  longitude?: number;
  source: 'manual' | 'gps';
}

interface LocationState {
  addresses: Address[];
  selected: Address | null;
  /** Whatever the app should behave as, from any of the three sources. */
  active: ActiveLocation | null;
  /** Shorthand — the thing nearly every screen actually wants. */
  activePincode: string | null;
  serviceability: Serviceability | null;
  loading: boolean;
  locateError: string | null;
  locating: boolean;
  /**
   * False until the first resolution attempt has finished. Screens must wait
   * for this before deciding the user has no location, or every cold start
   * flashes "where are you?" at someone whose GPS was about to answer.
   */
  ready: boolean;
  /** Nothing to go on — the app should ask. */
  needsLocation: boolean;

  select: (address: Address) => void;
  /** Adopt a typed pincode without saving an address. */
  setPincode: (pincode: string) => Promise<void>;
  /** Re-read the device position and adopt it. */
  detectFromGps: () => Promise<boolean>;
  refresh: () => Promise<void>;
  /** Reads the device position and returns a draft to prefill the address form. */
  locate: () => Promise<{
    latitude: number;
    longitude: number;
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
  } | null>;
}

const LocationContext = createContext<LocationState | null>(null);

const DETECTED_KEY = 'hb.location.detected';

/**
 * The detected pincode outlives the session on purpose. Asking for GPS on every
 * cold start is both slower than reading a cached answer and more intrusive
 * than the user expects, and the answer rarely changes between launches.
 */
const readStoredDetection = async (): Promise<DetectedLocation | null> => {
  try {
    const raw = await SecureStore.getItemAsync(DETECTED_KEY);
    return raw ? (JSON.parse(raw) as DetectedLocation) : null;
  } catch {
    return null;
  }
};

const storeDetection = async (value: DetectedLocation | null) => {
  try {
    if (value) await SecureStore.setItemAsync(DETECTED_KEY, JSON.stringify(value));
    else await SecureStore.deleteItemAsync(DETECTED_KEY);
  } catch {
    /* a cache that cannot be written is not worth failing a launch over */
  }
};

/**
 * How long to wait for the device before giving up and asking.
 *
 * `getCurrentPositionAsync` does not time out on its own: indoors, on a cold
 * GPS, or on an emulator with no fix set, it simply never settles. Without a
 * bound the app sits on "Finding your location…" forever with no way forward,
 * which is worse than admitting defeat and offering the pincode box. Ten
 * seconds is longer than a warm fix needs and shorter than a user will stare at
 * a spinner.
 */
const GPS_TIMEOUT_MS = 10_000;

const withTimeout = async <T,>(work: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [detected, setDetected] = useState<DetectedLocation | null>(null);
  const [serviceability, setServiceability] = useState<Serviceability | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /** GPS is attempted once per launch, never on every render of every screen. */
  const autoDetectTried = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await fetchAddresses();
      setAddresses(list);

      // Keep the current choice if it survived the refresh; otherwise fall back
      // to the default. Re-selecting on every refresh would throw away a
      // deliberate switch the moment anything else reloaded the list.
      setSelected((current) => {
        const stillThere = current ? list.find((a) => a.id === current.id) : undefined;
        return stillThere ?? list.find((a) => a.isDefault) ?? list[0] ?? null;
      });
    } catch {
      // A failed address load must not blank the app. The previous selection
      // stays usable and the next refresh tries again.
    } finally {
      setLoading(false);
    }
  }, [user]);

  /**
   * Reads the device position and turns it into something we can sell against.
   *
   * Reverse geocoding is what produces the pincode, and it is best-effort: it
   * needs a network round trip and on some Android devices returns nothing at
   * all. Without a pincode there is no location, so this reports failure rather
   * than adopting coordinates it cannot price against.
   */
  const detectFromGps = useCallback(async (): Promise<boolean> => {
    setLocating(true);
    setLocateError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocateError('Location permission was declined. Enter your pincode instead.');
        return false;
      }

      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        GPS_TIMEOUT_MS
      );
      if (!position) {
        setLocateError('Taking too long to find you. Enter your pincode instead.');
        return false;
      }
      const { latitude, longitude } = position.coords;

      // Reverse geocoding is a network call and gets the same treatment.
      let place: Location.LocationGeocodedAddress | undefined;
      try {
        const places = await withTimeout(
          Location.reverseGeocodeAsync({ latitude, longitude }),
          GPS_TIMEOUT_MS
        );
        place = places?.[0];
      } catch {
        place = undefined;
      }

      if (!place?.postalCode) {
        setLocateError('Could not work out your pincode. Enter it instead.');
        return false;
      }

      const next: DetectedLocation = {
        pincode: place.postalCode,
        city: place.city ?? null,
        state: place.region ?? null,
        latitude,
        longitude,
        source: 'gps',
      };
      setDetected(next);
      void storeDetection(next);
      return true;
    } catch {
      setLocateError('Could not read your location. Enter your pincode instead.');
      return false;
    } finally {
      setLocating(false);
    }
  }, []);

  const setPincode = useCallback(async (pincode: string) => {
    const trimmed = pincode.trim();
    const next: DetectedLocation = {
      pincode: trimmed,
      city: null,
      state: null,
      source: 'manual',
    };
    // A typed pincode is a deliberate choice and outranks whatever the last
    // saved address was, so the selection is dropped rather than left to win.
    setSelected(null);
    setDetected(next);
    setLocateError(null);
    await storeDetection(next);
  }, []);

  /**
   * Startup resolution, in the order that costs the user least:
   * a cached detection, then their saved addresses, then — only if neither
   * exists — the GPS prompt.
   */
  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setAddresses([]);
      setSelected(null);
      setServiceability(null);
      setReady(true);
      return;
    }

    setReady(false);
    void (async () => {
      const stored = await readStoredDetection();
      if (cancelled) return;
      if (stored) setDetected(stored);

      await refresh();
      if (cancelled) return;

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, refresh]);

  /**
   * Ask the device only when nothing else answered. Runs after `ready` so it
   * sees the settled result of the step above rather than racing it.
   */
  useEffect(() => {
    if (!ready || !user || autoDetectTried.current) return;
    if (selected || detected) return;

    autoDetectTried.current = true;
    void detectFromGps();
  }, [ready, user, selected, detected, detectFromGps]);

  const active = useMemo<ActiveLocation | null>(() => {
    // A saved address wins: it is the only source with a street on it.
    if (selected) {
      return {
        pincode: selected.pincode,
        city: selected.city ?? null,
        state: selected.state ?? null,
        address: selected,
        source: 'address',
      };
    }
    if (detected) {
      return {
        pincode: detected.pincode,
        city: detected.city,
        state: detected.state,
        address: null,
        source: detected.source,
      };
    }
    return null;
  }, [selected, detected]);

  const activePincode = active?.pincode ?? null;

  // Serviceability is a property of the pincode, so it is re-asked whenever the
  // active location changes and never cached across pincodes.
  useEffect(() => {
    let cancelled = false;

    if (!activePincode) {
      setServiceability(null);
      return;
    }

    void (async () => {
      try {
        const result = await checkServiceability(activePincode);
        if (!cancelled) setServiceability(result);
      } catch {
        if (!cancelled) setServiceability(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePincode]);

  /**
   * A GPS read used to prefill the address form. Unlike `detectFromGps` this
   * does not adopt the result — the user is mid-way through typing an address
   * and has not agreed to move the whole app yet.
   */
  const locate = useCallback(async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocateError('Location permission was declined. Enter the pincode instead.');
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;

      let place: Location.LocationGeocodedAddress | undefined;
      try {
        [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      } catch {
        place = undefined;
      }

      const line1 = [place?.name, place?.street].filter(Boolean).join(', ');

      return {
        latitude,
        longitude,
        ...(line1 ? { line1 } : {}),
        ...(place?.city ? { city: place.city } : {}),
        ...(place?.region ? { state: place.region } : {}),
        ...(place?.postalCode ? { pincode: place.postalCode } : {}),
      };
    } catch {
      setLocateError('Could not read your location. Enter the pincode instead.');
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  /** Choosing a saved address supersedes a detected pincode. */
  const select = useCallback((address: Address) => {
    setSelected(address);
  }, []);

  const value = useMemo<LocationState>(
    () => ({
      addresses,
      selected,
      active,
      activePincode,
      serviceability,
      loading,
      locating,
      locateError,
      ready,
      needsLocation: ready && !active,
      select,
      setPincode,
      detectFromGps,
      refresh,
      locate,
    }),
    [
      addresses,
      selected,
      active,
      activePincode,
      serviceability,
      loading,
      locating,
      locateError,
      ready,
      select,
      setPincode,
      detectFromGps,
      refresh,
      locate,
    ]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
};

export const useLocation = (): LocationState => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>.');
  return ctx;
};
