import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../services/api';
import { useAuth } from '../services/auth';
import {
  fetchMyApplications,
  type ApplicationType,
  type ProviderApplication,
  type Role,
} from '../services/endpoints';

/**
 * Which screen a provider app should show.
 *
 *   unregistered — no application yet; show the registration form
 *   pending      — submitted or under review; show the waiting state
 *   rejected     — show the reason and let them fix and resubmit
 *   approved     — the role has been granted; show the real app
 *
 * `approved` is decided by the SERVER-issued role, never by the application
 * row. An application that claims to be approved without the matching role is
 * still treated as pending — the role is the only thing that grants access, and
 * every provider endpoint enforces it independently.
 */
export type ProviderGate = 'loading' | 'unregistered' | 'pending' | 'rejected' | 'approved';

const ROLE_FOR_TYPE: Record<ApplicationType, Role> = {
  DOCTOR: 'DOCTOR',
  PHARMACY: 'PHARMACY',
  LAB: 'LAB_PARTNER',
};

interface ProviderApplicationState {
  gate: ProviderGate;
  application: ProviderApplication | null;
  error: string | null;
  /** Re-reads the application and the session role. */
  reload: () => Promise<void>;
}

/**
 * @param types Application kinds this app can hold. The doctor app passes a
 *   single type; the partner app passes both so a shop owner can be either.
 */
export const useProviderApplication = (types: ApplicationType[]): ProviderApplicationState => {
  const { user, refreshSession } = useAuth();
  const [application, setApplication] = useState<ProviderApplication | null>(null);
  const [gate, setGate] = useState<ProviderGate>('loading');
  const [error, setError] = useState<string | null>(null);

  const key = types.join(',');

  const load = useCallback(async () => {
    if (!user) {
      setGate('loading');
      return;
    }

    const allowedRoles = types.map((t) => ROLE_FOR_TYPE[t]);

    // Already granted — no need to look at the application at all.
    if (allowedRoles.includes(user.role)) {
      setGate('approved');
      setError(null);
      return;
    }

    try {
      const all = await fetchMyApplications();
      const relevant = all.filter((a) => types.includes(a.type));
      const current = relevant[0] ?? null;

      setApplication(current);
      setError(null);

      if (!current || current.status === 'DRAFT') setGate('unregistered');
      else if (current.status === 'REJECTED') setGate('rejected');
      else if (current.status === 'APPROVED') {
        // The application says approved but this session still carries the old
        // role. Re-mint the token, which re-reads the role from the database.
        const refreshed = await refreshSession();
        setGate(refreshed && allowedRoles.includes(refreshed.role) ? 'approved' : 'pending');
      } else setGate('pending');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your application.'));
      setGate('unregistered');
    }
    // `key` stands in for the `types` array so a new array literal on each
    // render does not retrigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, key, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  return { gate, application, error, reload: load };
};
