import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import * as Location from 'expo-location';
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
 * One selected address drives the whole app: which medicines are listed and at
 * what price, whether the store opens at all, which doctors can be seen in
 * person, and where an order is sent. Keeping it here rather than passing a
 * pincode down through screens is what stops two parts of the app disagreeing
 * about where the user is — a cart priced for one area and checked out to
 * another is the bug this shape exists to prevent.
 */

interface LocationState {
  addresses: Address[];
  selected: Address | null;
  /** null until the first check resolves, so screens can tell "unknown" from "no". */
  serviceability: Serviceability | null;
  loading: boolean;
  /** Set when the last GPS attempt failed, for the picker to show inline. */
  locateError: string | null;
  locating: boolean;

  select: (address: Address) => void;
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

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [serviceability, setServiceability] = useState<Serviceability | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

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

  useEffect(() => {
    if (user) void refresh();
    else {
      setAddresses([]);
      setSelected(null);
      setServiceability(null);
    }
  }, [user, refresh]);

  // Serviceability is a property of the pincode, so it is re-asked whenever the
  // selection changes and never cached across addresses.
  useEffect(() => {
    let cancelled = false;

    if (!selected) {
      setServiceability(null);
      return;
    }

    void (async () => {
      try {
        const result = await checkServiceability(selected.pincode);
        if (!cancelled) setServiceability(result);
      } catch {
        if (!cancelled) setServiceability(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected]);

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

      /**
       * Reverse geocoding is best-effort. It needs a network round trip and on
       * Android returns nothing at all on some devices, so the coordinates are
       * returned either way and the form stays editable — a picker that refuses
       * to proceed because a lookup failed is worse than one that asks the user
       * to confirm the pincode.
       */
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

  const value = useMemo<LocationState>(
    () => ({
      addresses,
      selected,
      serviceability,
      loading,
      locating,
      locateError,
      select: setSelected,
      refresh,
      locate,
    }),
    [addresses, selected, serviceability, loading, locating, locateError, refresh, locate]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
};

export const useLocation = (): LocationState => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>.');
  return ctx;
};
