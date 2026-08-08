import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import {
  fetchLabPackagesAdmin,
  fetchMedicines,
  saveLabPackage,
  saveMedicine,
  type DrugSchedule,
  type LabPackageAdminRow,
  type LabPackageInput,
  type MedicineInput,
  type MedicineRow,
  type TeleDrugList,
} from '../api/endpoints';
import {
  Drawer,
  PageHead,
  Pager,
  Resource,
  SearchBox,
  Status,
  Tabs,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * The canonical catalogue: what may be sold, and under what rules.
 *
 * Two fields here carry legal weight rather than commercial weight.
 * `schedule` is the Drugs & Cosmetics Act classification — SCHEDULE_X and
 * NARCOTIC may never be sold online at all. `teleList` is the Telemedicine
 * Practice Guidelines list, which decides whether a doctor may prescribe the
 * drug in a first consultation, only in a follow-up, or never. Both changes are
 * audited with their previous values, because "who reclassified this as OTC" is
 * a question that will eventually be asked by someone who is not an engineer.
 *
 * Price here is the reference MRP. What a patient actually pays comes from the
 * pharmacy's own inventory row, so editing this does not reprice any shop.
 */

const SCHEDULES: DrugSchedule[] = [
  'OTC',
  'SCHEDULE_H',
  'SCHEDULE_H1',
  'SCHEDULE_X',
  'NARCOTIC',
];
const TELE_LISTS: TeleDrugList[] = ['LIST_O', 'LIST_A', 'LIST_B', 'PROHIBITED'];

const TELE_HELP: Record<TeleDrugList, string> = {
  LIST_O: 'Over the counter — prescribable in any consultation.',
  LIST_A: 'First consultation allowed, but only over video.',
  LIST_B: 'Follow-up consultations only.',
  PROHIBITED: 'Never prescribable over telemedicine.',
};

const blankMedicine: MedicineInput = {
  name: '',
  category: '',
  price: 0,
  composition: '',
  manufacturer: '',
  schedule: 'OTC',
  teleList: 'LIST_O',
  requiresPrescription: false,
};

const MedicineForm: React.FC<{
  existing: MedicineRow | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ existing, onClose, onSaved }) => {
  const [form, setForm] = useState<MedicineInput>(
    existing
      ? {
          name: existing.name,
          category: existing.category,
          price: existing.price,
          composition: existing.composition ?? '',
          manufacturer: existing.manufacturer ?? '',
          schedule: existing.schedule,
          teleList: existing.teleList,
          requiresPrescription: existing.requiresPrescription,
        }
      : blankMedicine
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof MedicineInput>(key: K, value: MedicineInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveMedicine(
        {
          ...form,
          composition: form.composition?.trim() || null,
          manufacturer: form.manufacturer?.trim() || null,
        },
        existing?.id
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Scheduled drugs always need a prescription; letting the two disagree would
  // put a Schedule H drug in the catalogue as freely orderable.
  const scheduleForcesRx = form.schedule !== 'OTC';

  return (
    <Drawer
      open
      title={existing ? existing.name : 'New medicine'}
      subtitle={existing ? `Used by ${existing._count.inventory} shop(s)` : undefined}
      onClose={onClose}
      footer={
        <>
          <button className="btn outline sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn sm" onClick={() => void submit()} disabled={busy || !form.name}>
            {existing ? 'Save changes' : 'Add to catalogue'}
          </button>
        </>
      }
    >
      {error ? <div className="banner error">{error}</div> : null}

      <div className="form-row">
        <label>
          Name
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(e) => set('category', e.target.value)} />
        </label>
      </div>

      <div className="form-row">
        <label>
          Reference MRP (₹)
          <input
            type="number"
            min={0}
            value={form.price}
            onChange={(e) => set('price', Number(e.target.value))}
          />
        </label>
        <label>
          Manufacturer
          <input
            value={form.manufacturer ?? ''}
            onChange={(e) => set('manufacturer', e.target.value)}
          />
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Composition</span>
        <input
          value={form.composition ?? ''}
          onChange={(e) => set('composition', e.target.value)}
          placeholder="Paracetamol 500mg"
        />
      </label>

      <div className="card">
        <h3>Regulatory classification</h3>
        <div className="form-row">
          <label>
            Drug schedule
            <select
              value={form.schedule}
              onChange={(e) => {
                const next = e.target.value as DrugSchedule;
                setForm((f) => ({
                  ...f,
                  schedule: next,
                  requiresPrescription: next === 'OTC' ? f.requiresPrescription : true,
                }));
              }}
            >
              {SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Telemedicine list
            <select
              value={form.teleList}
              onChange={(e) => set('teleList', e.target.value as TeleDrugList)}
            >
              {TELE_LISTS.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="inline-note">{TELE_HELP[form.teleList]}</p>

        {form.schedule === 'SCHEDULE_X' || form.schedule === 'NARCOTIC' ? (
          <div className="banner error">
            Schedule X and narcotic drugs may not be sold online and must stay out of the
            patient-facing catalogue.
          </div>
        ) : null}

        <div className="checkbox">
          <input
            type="checkbox"
            checked={form.requiresPrescription}
            disabled={scheduleForcesRx}
            onChange={(e) => set('requiresPrescription', e.target.checked)}
          />
          <span>
            Requires a prescription
            {scheduleForcesRx ? ' — forced on by the schedule' : ''}
          </span>
        </div>
      </div>
    </Drawer>
  );
};

const Medicines: React.FC = () => {
  const [search, setSearch] = useState('');
  const [schedule, setSchedule] = useState<'' | DrugSchedule>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MedicineRow | null | undefined>(undefined);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchMedicines({
        ...(term ? { search: term } : {}),
        ...(schedule ? { schedule } : {}),
        page,
        limit: 25,
      }),
    [term, schedule, page]
  );

  return (
    <>
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name, composition or manufacturer"
        />
        <select
          value={schedule}
          onChange={(e) => {
            setSchedule(e.target.value as typeof schedule);
            setPage(1);
          }}
        >
          <option value="">All schedules</option>
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setEditing(null)}>
          Add medicine
        </button>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.medicines.length === 0}
        emptyTitle="No medicines match"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Composition</th>
                    <th className="num">Reference MRP</th>
                    <th>Schedule</th>
                    <th>Telemedicine</th>
                    <th>Prescription</th>
                    <th className="num">Stocked by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.medicines.map((m) => (
                    <tr key={m.id} onClick={() => setEditing(m)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn">{m.name}</button>
                        <span className="sub">{m.category}</span>
                      </td>
                      <td>
                        {m.composition ?? <span className="sub">—</span>}
                        {m.manufacturer ? <span className="sub">{m.manufacturer}</span> : null}
                      </td>
                      <td className="num">{money(m.price)}</td>
                      <td>
                        <Status value={m.schedule} />
                      </td>
                      <td>
                        <Status value={m.teleList} />
                      </td>
                      <td>{m.requiresPrescription ? 'Required' : 'Not required'}</td>
                      <td className="num">{m._count.inventory}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Resource>

      {editing !== undefined ? (
        <MedicineForm
          existing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={list.reload}
        />
      ) : null}
    </>
  );
};

const blankPackage: LabPackageInput = {
  testName: '',
  category: '',
  price: 0,
  sampleType: '',
  fastingReq: false,
  description: '',
};

const LabPackageForm: React.FC<{
  existing: LabPackageAdminRow | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ existing, onClose, onSaved }) => {
  const [form, setForm] = useState<LabPackageInput>(
    existing
      ? {
          testName: existing.testName,
          category: existing.category,
          price: existing.price,
          sampleType: existing.sampleType,
          fastingReq: existing.fastingReq,
          description: existing.description ?? '',
        }
      : blankPackage
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof LabPackageInput>(key: K, value: LabPackageInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveLabPackage(
        { ...form, description: form.description?.trim() || null },
        existing?.id
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title={existing ? existing.testName : 'New test'}
      subtitle={
        existing
          ? `Offered by ${existing._count.offerings} lab(s) · ${existing._count.prices} area price(s)`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn outline sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn sm" onClick={() => void submit()} disabled={busy || !form.testName}>
            {existing ? 'Save changes' : 'Add test'}
          </button>
        </>
      }
    >
      {error ? <div className="banner error">{error}</div> : null}

      <div className="form-row">
        <label>
          Test name
          <input value={form.testName} onChange={(e) => set('testName', e.target.value)} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(e) => set('category', e.target.value)} />
        </label>
      </div>

      <div className="form-row">
        <label>
          National fallback price (₹)
          <input
            type="number"
            min={0}
            value={form.price}
            onChange={(e) => set('price', Number(e.target.value))}
          />
        </label>
        <label>
          Sample type
          <input
            value={form.sampleType}
            placeholder="Blood, urine…"
            onChange={(e) => set('sampleType', e.target.value)}
          />
        </label>
      </div>

      <div className="checkbox">
        <input
          type="checkbox"
          checked={form.fastingReq}
          onChange={(e) => set('fastingReq', e.target.checked)}
        />
        <span>Requires fasting</span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Description</span>
        <textarea
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>

      <p className="inline-note">
        This price is only the fallback used when no area band covers the patient's location. What a
        patient is actually charged comes from Lab pricing, which sets one price per test per area.
      </p>
    </Drawer>
  );
};

const LabTests: React.FC = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LabPackageAdminRow | null | undefined>(undefined);
  const term = useDebounced(search);

  const list = useAsync(
    () => fetchLabPackagesAdmin({ ...(term ? { search: term } : {}), page, limit: 25 }),
    [term, page]
  );

  return (
    <>
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Test or category"
        />
        <button className="btn" onClick={() => setEditing(null)}>
          Add test
        </button>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource state={list} isEmpty={(d) => d.packages.length === 0} emptyTitle="No tests match">
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Sample</th>
                    <th className="num">Fallback price</th>
                    <th>Fasting</th>
                    <th className="num">Labs offering</th>
                    <th className="num">Area prices</th>
                  </tr>
                </thead>
                <tbody>
                  {data.packages.map((p) => (
                    <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn">{p.testName}</button>
                        <span className="sub">{p.category}</span>
                      </td>
                      <td>{p.sampleType}</td>
                      <td className="num">{money(p.price)}</td>
                      <td>{p.fastingReq ? 'Required' : 'No'}</td>
                      <td className="num">{p._count.offerings}</td>
                      <td className="num">
                        {p._count.prices === 0 ? (
                          <Status value="NONE SET" tone="warning" />
                        ) : (
                          p._count.prices
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Resource>

      {editing !== undefined ? (
        <LabPackageForm
          existing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={list.reload}
        />
      ) : null}
    </>
  );
};

export const Catalogue: React.FC = () => {
  const [tab, setTab] = useState('medicines');

  return (
    <>
      <PageHead
        title="Catalogue"
        lead="What may be sold and under what rules. Drug schedule and telemedicine list are legal classifications — both are audited when changed."
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'medicines', label: 'Medicines' },
          { key: 'tests', label: 'Lab tests' },
        ]}
      />

      {tab === 'medicines' ? <Medicines /> : <LabTests />}
    </>
  );
};
