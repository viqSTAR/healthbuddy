import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Users } from './Users';
import type { AdminUser } from '../api/endpoints';

/**
 * The Users page performs the two most destructive actions in the panel:
 * suspending an account, which throws somebody out mid-session, and closing
 * one, which destroys their identity and cannot be undone.
 *
 * What is worth testing is not the markup. It is the guards — that erasure
 * needs a typed confirmation, that a cancelled prompt does nothing at all, and
 * that the button is not offered where the server would refuse it anyway.
 */

const { fetchUsers, setUserSuspended, eraseUser } = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  setUserSuspended: vi.fn(),
  eraseUser: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({ fetchUsers, setUserSuspended, eraseUser }));
vi.mock('../api/auth', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));

const aUser = (over: Partial<AdminUser> = {}): AdminUser =>
  ({
    id: 'user-1',
    phoneNumber: '+15551230000',
    role: 'PATIENT',
    isVerified: true,
    isSuspended: false,
    anonymisedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    patient: { fullName: 'Asha Kumar' },
    ...over,
  }) as AdminUser;

const showing = (...users: AdminUser[]) => {
  fetchUsers.mockResolvedValue({ users, total: users.length });
};

beforeEach(() => {
  vi.restoreAllMocks();
  fetchUsers.mockReset();
  setUserSuspended.mockReset().mockResolvedValue(aUser());
  eraseUser.mockReset().mockResolvedValue({
    userId: 'user-1',
    anonymisedAt: '2026-08-19T00:00:00.000Z',
    removed: { profile: true, addresses: 2, devices: 1, notifications: 3, documents: 0 },
    retained: [],
  });
});

afterEach(() => {
  // Without this each render stacks another copy of the table in the same
  // document, and every query then matches several buttons at once.
  cleanup();
  vi.unstubAllGlobals();
});

const clickButton = async (name: RegExp) => {
  const button = await screen.findByRole('button', { name });
  button.click();
};

describe('closing an account is guarded', () => {
  test('nothing happens unless the confirmation is typed exactly', async () => {
    showing(aUser());
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('erase')); // lower case

    render(<Users />);
    await clickButton(/^Close$/);

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(eraseUser).not.toHaveBeenCalled();
  });

  test('cancelling the prompt does nothing', async () => {
    showing(aUser());
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null));

    render(<Users />);
    await clickButton(/^Close$/);

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(eraseUser).not.toHaveBeenCalled();
  });

  test('typing ERASE goes through, and the reason is passed on', async () => {
    showing(aUser());
    const ask = vi.fn().mockReturnValueOnce('ERASE').mockReturnValueOnce('Requested by email');
    vi.stubGlobal('prompt', ask);

    render(<Users />);
    await clickButton(/^Close$/);

    await waitFor(() => expect(eraseUser).toHaveBeenCalledWith('user-1', 'Requested by email'));
  });

  test('the warning names what survives, so the operator is not misled', async () => {
    showing(aUser());
    const ask = vi.fn().mockReturnValue(null);
    vi.stubGlobal('prompt', ask);

    render(<Users />);
    await clickButton(/^Close$/);

    await waitFor(() => expect(ask).toHaveBeenCalled());
    const warning = String(ask.mock.calls[0]![0]);
    expect(warning).toMatch(/cannot be undone/i);
    expect(warning).toMatch(/records are kept/i);
  });
});

describe('the action is only offered where it applies', () => {
  test('a provider account gets no Close button — the server refuses it', async () => {
    showing(aUser({ role: 'DOCTOR', patient: null, doctor: { name: 'Dr Rao', specialty: 'ENT' } }));

    render(<Users />);
    await screen.findByRole('button', { name: /Suspend/ });

    expect(screen.queryByRole('button', { name: /^Close$/ })).toBeNull();
  });

  test('an already-closed account offers neither action', async () => {
    showing(aUser({ anonymisedAt: '2026-08-01T00:00:00.000Z' }));

    render(<Users />);
    await screen.findByText(/Closed/);

    expect(screen.queryByRole('button', { name: /^Close$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Suspend/ })).toBeNull();
  });

  test('the signed-in admin cannot act on their own row', async () => {
    showing(aUser({ id: 'admin-1' }));

    render(<Users />);
    await screen.findByText('You');

    expect(screen.queryByRole('button', { name: /Suspend/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Close$/ })).toBeNull();
  });
});

describe('suspension', () => {
  test('suspending asks for a reason and sends it', async () => {
    showing(aUser());
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Fraudulent orders'));

    render(<Users />);
    await clickButton(/Suspend/);

    await waitFor(() =>
      expect(setUserSuspended).toHaveBeenCalledWith('user-1', true, 'Fraudulent orders')
    );
  });

  test('cancelling the reason prompt aborts the suspension', async () => {
    showing(aUser());
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null));

    render(<Users />);
    await clickButton(/Suspend/);

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(setUserSuspended).not.toHaveBeenCalled();
  });

  test('restoring does not demand a reason', async () => {
    showing(aUser({ isSuspended: true }));
    const ask = vi.fn();
    vi.stubGlobal('prompt', ask);

    render(<Users />);
    await clickButton(/Restore/);

    await waitFor(() => expect(setUserSuspended).toHaveBeenCalledWith('user-1', false, undefined));
    expect(ask).not.toHaveBeenCalled();
  });
});
