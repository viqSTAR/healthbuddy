import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PharmacyDetail } from './PharmacyDetail';

/**
 * The stock control page writes to a partner's shelf.
 *
 * Two things are worth pinning. Delisting is destructive and needs a typed
 * confirmation, like every other irreversible control in the panel. And the
 * medicine picker must not offer a Schedule X drug: the server refuses those
 * outright, so listing one is a dropdown entry whose only possible outcome is
 * an error.
 */

const api = vi.hoisted(() => ({
  fetchPharmacy: vi.fn(),
  fetchPharmacyInventory: vi.fn(),
  fetchStockMovements: vi.fn(),
  adminUpsertInventory: vi.fn(),
  adminRecordStockMovement: vi.fn(),
  adminRemoveInventory: vi.fn(),
  fetchMedicines: vi.fn(),
}));

vi.mock('../api/endpoints', () => api);

const line = (over: Record<string, unknown> = {}) => ({
  id: 'line-1',
  price: 32,
  stock: 300,
  reserved: 0,
  available: 300,
  reorderLevel: 20,
  isActive: true,
  batchNumber: null,
  expiryDate: null,
  updatedAt: '2026-08-20T00:00:00.000Z',
  medicine: {
    id: 'med-1',
    name: 'Cetirizine 10mg',
    category: 'Allergy',
    schedule: 'OTC',
    requiresPrescription: false,
  },
  ...over,
});

beforeEach(() => {
  api.fetchPharmacy.mockReset().mockResolvedValue({
    pharmacy: {
      id: 'ph-1',
      name: 'Central Pharmacy',
      address: '221 Wellness Road',
      isActive: true,
      verifiedAt: '2026-08-01T00:00:00.000Z',
      drugLicenceNumber: 'MH-DL-1',
      drugLicenceExpiry: '2028-01-01T00:00:00.000Z',
      pharmacistName: 'A. Rao',
    },
    ordersByStatus: [],
    lifetimeRevenue: 0,
    earnings: { total: 0, legs: 0 },
    inventory: { lowStockLines: 1, expiringLines: 0 },
    recentOrders: [],
    writeOffs: [],
  });
  api.fetchPharmacyInventory.mockReset().mockResolvedValue({ lines: [line()], total: 1 });
  api.fetchStockMovements.mockReset().mockResolvedValue({ movements: [], total: 0 });
  api.adminRemoveInventory.mockReset().mockResolvedValue({});
  api.adminRecordStockMovement.mockReset().mockResolvedValue({ medicineId: 'med-1', stock: 260, delta: -40 });
  api.adminUpsertInventory.mockReset().mockResolvedValue(line());
  api.fetchMedicines.mockReset().mockResolvedValue({
    medicines: [
      { id: 'med-1', name: 'Cetirizine 10mg', schedule: 'OTC' },
      { id: 'med-x', name: 'Alprazolam 0.25mg', schedule: 'SCHEDULE_X' },
      { id: 'med-n', name: 'Morphine 10mg', schedule: 'NARCOTIC' },
    ],
    total: 3,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/pharmacies/ph-1']}>
      <Routes>
        <Route path="/pharmacies/:id" element={<PharmacyDetail />} />
      </Routes>
    </MemoryRouter>
  );

describe('delisting is guarded', () => {
  test('a wrong confirmation removes nothing', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('delist'));

    renderPage();
    (await screen.findByRole('button', { name: /Delist/ })).click();

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(api.adminRemoveInventory).not.toHaveBeenCalled();
  });

  test('cancelling removes nothing', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null));

    renderPage();
    (await screen.findByRole('button', { name: /Delist/ })).click();

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(api.adminRemoveInventory).not.toHaveBeenCalled();
  });

  test('typing DELIST goes through', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('DELIST'));

    renderPage();
    (await screen.findByRole('button', { name: /Delist/ })).click();

    await waitFor(() => expect(api.adminRemoveInventory).toHaveBeenCalledWith('ph-1', 'med-1'));
  });

  test('the warning says stock reserved against a paid order blocks it', async () => {
    const ask = vi.fn().mockReturnValue(null);
    vi.stubGlobal('prompt', ask);

    renderPage();
    (await screen.findByRole('button', { name: /Delist/ })).click();

    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(String(ask.mock.calls[0]![0])).toMatch(/already paid for/i);
  });
});

describe('the medicine picker refuses what the server refuses', () => {
  test('Schedule X and narcotics are not offered', async () => {
    renderPage();
    await screen.findByText(/List a medicine on this shelf/);

    const options = [...document.querySelectorAll('option')].map((o) => o.textContent ?? '');

    expect(options.some((o) => /Cetirizine/.test(o))).toBe(true);
    expect(options.some((o) => /Alprazolam/.test(o))).toBe(false);
    expect(options.some((o) => /Morphine/.test(o))).toBe(false);
  });
});

describe('the shelf reads correctly', () => {
  test('a line with everything reserved shows as out of stock', async () => {
    api.fetchPharmacyInventory.mockResolvedValue({
      lines: [line({ stock: 100, reserved: 100, available: 0 })],
      total: 1,
    });

    renderPage();

    // Sellable is what matters to a patient — 100 on the shelf and none of it
    // available is the case that looks fine and is not.
    await waitFor(() => expect(screen.getByText('OUT')).toBeTruthy());
  });

  test('a line at or below its reorder level is flagged low', async () => {
    api.fetchPharmacyInventory.mockResolvedValue({
      lines: [line({ stock: 15, reserved: 0, available: 15, reorderLevel: 20 })],
      total: 1,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('LOW')).toBeTruthy());
  });

  test('an expired batch is called expired, not merely soon', async () => {
    api.fetchPharmacyInventory.mockResolvedValue({
      lines: [line({ expiryDate: '2020-01-01T00:00:00.000Z' })],
      total: 1,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('EXPIRED')).toBeTruthy());
  });
});
