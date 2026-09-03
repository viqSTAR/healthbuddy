import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Retention } from './Retention';

/**
 * The retention page runs a destructive job by hand.
 *
 * It is safe by construction — nothing under a statutory floor is touched — but
 * "safe by construction" is a claim about the service, and the page still owes
 * the operator a confirmation and an honest picture of what is left afterwards.
 */

const { fetchRetentionReport, runRetentionSweep } = vi.hoisted(() => ({
  fetchRetentionReport: vi.fn(),
  runRetentionSweep: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({ fetchRetentionReport, runRetentionSweep }));

const report = (over: Record<string, unknown> = {}) => ({
  ranAt: '2026-08-19T03:15:00.000Z',
  dryRun: true,
  swept: {
    notifications: 4,
    staleDeviceTokens: 1,
    processedWebhookEvents: 0,
    healthTipDeliveries: 0,
  },
  awaitingReview: {
    consultations: 12,
    prescriptions: 9,
    labOrders: 3,
    payments: 0,
    auditEntries: 0,
  },
  note: 'Nothing was deleted.',
  ...over,
});

beforeEach(() => {
  fetchRetentionReport.mockReset().mockResolvedValue(report());
  runRetentionSweep.mockReset().mockResolvedValue(report({ dryRun: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const clickSweep = async () => {
  const button = await screen.findByRole('button', { name: /Run the sweep now/ });
  button.click();
};

describe('running the sweep is guarded', () => {
  test('a wrong confirmation deletes nothing', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('sweep')); // lower case

    render(<Retention />);
    await clickSweep();

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(runRetentionSweep).not.toHaveBeenCalled();
  });

  test('cancelling deletes nothing', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null));

    render(<Retention />);
    await clickSweep();

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(runRetentionSweep).not.toHaveBeenCalled();
  });

  test('typing SWEEP applies it', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('SWEEP'));

    render(<Retention />);
    await clickSweep();

    await waitFor(() => expect(runRetentionSweep).toHaveBeenCalledWith(true));
  });

  test('the confirmation says how many rows are at stake', async () => {
    const ask = vi.fn().mockReturnValue(null);
    vi.stubGlobal('prompt', ask);

    render(<Retention />);
    await clickSweep();

    await waitFor(() => expect(ask).toHaveBeenCalled());
    // 4 notifications + 1 stale token.
    expect(String(ask.mock.calls[0]![0])).toMatch(/5 expired row/);
  });

  test('with nothing expired it refuses rather than running an empty sweep', async () => {
    fetchRetentionReport.mockResolvedValue(
      report({
        swept: {
          notifications: 0,
          staleDeviceTokens: 0,
          processedWebhookEvents: 0,
          healthTipDeliveries: 0,
        },
      })
    );
    const ask = vi.fn();
    vi.stubGlobal('prompt', ask);

    render(<Retention />);
    await clickSweep();

    await screen.findByText(/Nothing is currently past its retention period/);
    expect(ask).not.toHaveBeenCalled();
    expect(runRetentionSweep).not.toHaveBeenCalled();
  });
});

describe('what the page reports', () => {
  test('records under a statutory floor are shown as counts, not actions', async () => {
    render(<Retention />);

    await screen.findByText('Consultations');
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/Deletion is now/)).toBeTruthy();

    // There is exactly one destructive control, and it is the short-retention
    // sweep — nothing on this page offers to delete a medical record.
    const destructive = screen
      .getAllByRole('button')
      .filter((b) => /sweep|delete|remove/i.test(b.textContent ?? ''));
    expect(destructive).toHaveLength(1);
  });

  test('after a sweep the table shows what is LEFT, not what was removed', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('SWEEP'));
    // The reload after applying returns an empty position.
    fetchRetentionReport
      .mockResolvedValueOnce(report())
      .mockResolvedValue(
        report({
          swept: {
            notifications: 0,
            staleDeviceTokens: 0,
            processedWebhookEvents: 0,
            healthTipDeliveries: 0,
          },
        })
      );

    render(<Retention />);
    await clickSweep();

    // The banner reports what happened...
    await screen.findByText(/5 row\(s\) removed/);

    // ...and the table no longer claims those rows are pending, which is what
    // it did when the applied result was allowed to shadow the fresh report.
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      const notifications = rows.find((r) => /Notifications/.test(r.textContent ?? ''));
      expect(notifications?.textContent).toMatch(/Notifications\s*0/);
    });
  });
});
