import React, { useMemo, useState } from 'react';
import {
  Badge,
  EmptyState,
  ErrorState,
  Loading,
  formatDate,
  useAsync,
} from '../components/ui';
import {
  fetchLabPackages,
  fetchTestPrices,
  removeTestPrice,
  upsertTestPrice,
  type TestPriceBand,
} from '../api/endpoints';

/**
 * What each test costs, per area.
 *
 * This page exists because labs do not set their own prices. A patient cannot
 * judge sample handling the way they can judge a restaurant, so letting labs
 * undercut each other selects for the cheapest handling rather than the best.
 * One price per test per area means labs compete on turnaround and
 * accreditation instead — and that price is set here.
 *
 * Resolution is most-specific-first: a city band beats a state band, which
 * beats the national one, which beats the catalogue's reference price.
 */
export const LabPricing: React.FC = () => {
  const packages = useAsync(fetchLabPackages, []);
  const [selectedPackage, setSelectedPackage] = useState<string>('');
  const prices = useAsync(() => fetchTestPrices(selectedPackage || undefined), [selectedPackage]);

  const [editing, setEditing] = useState<Partial<TestPriceBand> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, TestPriceBand[]>();
    for (const band of prices.data ?? []) {
      map.set(band.testName, [...(map.get(band.testName) ?? []), band]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [prices.data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.labPackageId) return;

    setBusy(true);
    setError(null);
    try {
      await upsertTestPrice({
        labPackageId: editing.labPackageId,
        state: editing.state ?? '',
        city: editing.city ?? '',
        price: Number(editing.price) || 0,
        homeCollectionFee: Number(editing.homeCollectionFee) || 0,
        isActive: editing.isActive ?? true,
        ...(editing.note ? { note: editing.note } : {}),
      });
      setEditing(null);
      prices.reload();
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Could not save that price.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (band: TestPriceBand) => {
    if (!confirm(`Remove the ${band.scope} price for ${band.testName}?`)) return;
    try {
      await removeTestPrice(band.id);
      prices.reload();
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Could not remove that band.');
    }
  };

  if (prices.loading) return <Loading label="Loading prices" />;
  if (prices.error) return <ErrorState message={prices.error} onRetry={prices.reload} />;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Lab pricing</h1>
          <p className="sub">
            One price per test per area. Labs choose which tests they can run; they do not set the
            price.
          </p>
        </div>
        <button
          className="btn"
          onClick={() =>
            setEditing({
              labPackageId: packages.data?.[0]?.id ?? '',
              state: '',
              city: '',
              price: 0,
              homeCollectionFee: 0,
              isActive: true,
            })
          }
        >
          Add a price band
        </button>
      </header>

      <div className="toolbar">
        <select value={selectedPackage} onChange={(e) => setSelectedPackage(e.target.value)}>
          <option value="">All tests</option>
          {(packages.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.testName}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {editing ? (
        <form className="card" onSubmit={save}>
          <h3>{editing.id ? 'Edit price band' : 'New price band'}</h3>

          <label>
            Test
            <select
              value={editing.labPackageId ?? ''}
              disabled={Boolean(editing.id)}
              onChange={(e) => setEditing({ ...editing, labPackageId: e.target.value })}
              required
            >
              {(packages.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.testName} (reference ₹{p.price})
                </option>
              ))}
            </select>
          </label>

          <div className="form-row">
            <label>
              State
              <input
                value={editing.state ?? ''}
                onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                placeholder="Leave blank for all of India"
              />
            </label>
            <label>
              City
              <input
                value={editing.city ?? ''}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                placeholder="Leave blank for the whole state"
              />
            </label>
          </div>
          <p className="sub">
            A city needs its state — there is more than one Hyderabad. Blank state and city sets the
            national rate every unpriced area falls back to.
          </p>

          <div className="form-row">
            <label>
              Price (₹)
              <input
                type="number"
                min={0}
                step="0.01"
                value={editing.price ?? 0}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              Home collection fee (₹)
              <input
                type="number"
                min={0}
                step="0.01"
                value={editing.homeCollectionFee ?? 0}
                onChange={(e) =>
                  setEditing({ ...editing, homeCollectionFee: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <label>
            Note
            <input
              value={editing.note ?? ''}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              placeholder="Why this rate differs, for whoever reads it next"
            />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={editing.isActive ?? true}
              onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Active
          </label>

          <div className="row-actions">
            <button type="button" className="btn outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Saving…' : 'Save band'}
            </button>
          </div>
        </form>
      ) : null}

      {grouped.length === 0 ? (
        <EmptyState
          title="No price bands yet"
          message="Add a national band first — it is what every unpriced area falls back to."
        />
      ) : (
        grouped.map(([testName, bands]) => (
          <section key={testName} className="card">
            <h3>{testName}</h3>
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Price</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bands
                  // Most specific first, which is also the resolution order.
                  .sort((a, b) => (b.city ? 2 : b.state ? 1 : 0) - (a.city ? 2 : a.state ? 1 : 0))
                  .map((band) => (
                    <tr key={band.id}>
                      <td>
                        <strong>{band.scope}</strong>
                        {band.note ? <div className="sub">{band.note}</div> : null}
                      </td>
                      <td>₹{band.price.toFixed(2)}</td>
                      <td>
                        {band.homeCollectionFee > 0
                          ? `₹${band.homeCollectionFee.toFixed(2)}`
                          : 'Free'}
                      </td>
                      <td>
                        <Badge
                          label={band.isActive ? 'Active' : 'Inactive'}
                          tone={band.isActive ? 'success' : 'neutral'}
                        />
                      </td>
                      <td className="sub">{formatDate(band.updatedAt)}</td>
                      <td className="row-actions">
                        <button className="btn outline sm" onClick={() => setEditing(band)}>
                          Edit
                        </button>
                        <button className="btn danger sm" onClick={() => void remove(band)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table></div>
          </section>
        ))
      )}
    </div>
  );
};
