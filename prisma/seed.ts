import { PrismaClient, type DrugSchedule, type TeleDrugList } from '@prisma/client';

const prisma = new PrismaClient();

const DOCTORS = [
  { phone: '+15551000001', name: 'Dr. Aisha Mehta', specialty: 'Cardiologist', qualification: 'MBBS, MD (Cardiology)', experienceYears: 12, consultationFee: 750, rating: 4.9, clinicAddress: 'Heart Care Center, 5th Avenue', reg: 'MH-2013-104521' },
  { phone: '+15551000002', name: 'Dr. Nisha Rao', specialty: 'Dermatologist', qualification: 'MBBS, MD (Dermatology)', experienceYears: 8, consultationFee: 600, rating: 4.8, clinicAddress: 'Skin & Aesthetics Clinic', reg: 'MH-2017-118834' },
  { phone: '+15551000003', name: 'Dr. Priya Sharma', specialty: 'General Physician', qualification: 'MBBS, MD (General Medicine)', experienceYears: 15, consultationFee: 500, rating: 5.0, clinicAddress: 'Wellness Medical Hub', reg: 'DL-2010-091277' },
  { phone: '+15551000004', name: 'Dr. Robert Chen', specialty: 'Pediatrician', qualification: 'MBBS, DCH', experienceYears: 10, consultationFee: 650, rating: 4.9, clinicAddress: 'Kids First Health Center', reg: 'KA-2015-143902' },
  { phone: '+15551000005', name: 'Dr. Marcus Vance', specialty: 'Orthopedic', qualification: 'MBBS, MS (Ortho)', experienceYears: 14, consultationFee: 800, rating: 4.7, clinicAddress: 'Bone & Joint Institute', reg: 'TN-2011-076615' },
  { phone: '+15551000006', name: 'Dr. Leena Kapoor', specialty: 'Neurologist', qualification: 'MBBS, DM (Neurology)', experienceYears: 11, consultationFee: 900, rating: 4.8, clinicAddress: 'NeuroCare Specialty Clinic', reg: 'MH-2014-129048' },
];

/**
 * Catalogue with the two classifications that drive real behaviour:
 *
 *   schedule — Drugs and Cosmetics Act. SCHEDULE_X and NARCOTIC are refused for
 *              online sale outright, so partners cannot even stock them.
 *   teleList — Telemedicine Practice Guidelines. Decides whether a doctor may
 *              prescribe the drug on a first consult, only over video, or only
 *              at follow-up.
 *
 * The Alprazolam and Tramadol rows exist so the blocked paths are exercised by
 * real data rather than only by tests.
 */
const MEDICINES: {
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
  composition?: string;
  schedule: DrugSchedule;
  teleList: TeleDrugList;
  requiresPrescription: boolean;
}[] = [
  { name: 'Paracetamol 500mg', category: 'Pain Relief', price: 25, stock: 250, description: 'Relieves mild to moderate fever and pain.', composition: 'Paracetamol IP 500mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Cetirizine 10mg', category: 'Allergy', price: 32, stock: 300, description: '24-hour allergy relief from sneezing and runny nose.', composition: 'Cetirizine Hydrochloride IP 10mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Vitamin C 1000mg', category: 'Supplements', price: 149, stock: 500, description: 'Immunity booster chewable tablets.', composition: 'Ascorbic Acid 1000mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Oral Rehydration Salts', category: 'Digestive Health', price: 22, stock: 400, description: 'Restores fluid and electrolyte balance.', composition: 'ORS WHO formula', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Ibuprofen 400mg', category: 'Pain Relief', price: 48, stock: 220, description: 'Anti-inflammatory for pain and swelling.', composition: 'Ibuprofen IP 400mg', schedule: 'SCHEDULE_H', teleList: 'LIST_A', requiresPrescription: true },
  { name: 'Omeprazole 20mg', category: 'Digestive Health', price: 86, stock: 150, description: 'Relief from acid reflux and heartburn.', composition: 'Omeprazole IP 20mg', schedule: 'SCHEDULE_H', teleList: 'LIST_A', requiresPrescription: true },
  { name: 'Amoxicillin 250mg', category: 'Antibiotics', price: 112, stock: 100, description: 'Broad-spectrum antibiotic for bacterial infections.', composition: 'Amoxicillin Trihydrate IP 250mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Metformin 500mg', category: 'Diabetes', price: 74, stock: 180, description: 'Controls blood sugar in type 2 diabetes.', composition: 'Metformin Hydrochloride IP 500mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Aspirin 75mg', category: 'Cardiac', price: 38, stock: 400, description: 'Low-dose blood thinner for heart health.', composition: 'Acetylsalicylic Acid IP 75mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Alprazolam 0.25mg', category: 'Psychiatry', price: 55, stock: 0, description: 'Anxiolytic. Cannot be sold or prescribed online.', composition: 'Alprazolam IP 0.25mg', schedule: 'SCHEDULE_X', teleList: 'PROHIBITED', requiresPrescription: true },
  { name: 'Tramadol 50mg', category: 'Pain Relief', price: 68, stock: 0, description: 'Opioid analgesic. Cannot be sold or prescribed online.', composition: 'Tramadol Hydrochloride IP 50mg', schedule: 'NARCOTIC', teleList: 'PROHIBITED', requiresPrescription: true },
];

const LAB_PACKAGES = [
  { testName: 'Full Body Health Checkup', category: 'Preventive Care', price: 1999, sampleType: 'Blood & Urine', fastingReq: true },
  { testName: 'Lipid Profile & Cholesterol Test', category: 'Cardiology', price: 699, sampleType: 'Blood', fastingReq: true },
  { testName: 'Thyroid Stimulating Hormone (TSH)', category: 'Endocrinology', price: 449, sampleType: 'Blood', fastingReq: false },
  { testName: 'Complete Blood Count (CBC)', category: 'General', price: 349, sampleType: 'Blood', fastingReq: false },
  { testName: 'HbA1c Diabetes Monitoring', category: 'Diabetology', price: 549, sampleType: 'Blood', fastingReq: false },
  { testName: 'Vitamin D Total', category: 'Nutrition', price: 1299, sampleType: 'Blood', fastingReq: false },
  { testName: 'Liver Function Test (LFT)', category: 'Gastroenterology', price: 799, sampleType: 'Blood', fastingReq: true },
];

const PHARMACIES = [
  { phone: '+15552000001', name: 'Health Buddy Central Pharmacy', address: '221 Wellness Road, Andheri West', city: 'Mumbai', state: 'Maharashtra', pincode: '400058', licence: 'MH-RTL-20-114523', markup: 1.0 },
  { phone: '+15552000002', name: 'CarePlus Chemists', address: '14 Model Town, Sector 9', city: 'Delhi', state: 'Delhi', pincode: '110009', licence: 'DL-RTL-20-089114', markup: 0.94 },
];

const LABS = [
  { phone: '+15553000001', name: 'Health Buddy Diagnostics', location: 'Mumbai', address: '88 Lab Street, Powai', city: 'Mumbai', state: 'Maharashtra', pincode: '400076', reg: 'MH-CLE-2019-4412', nabl: true, nablCert: 'MC-3387', markup: 1.0 },
  { phone: '+15553000002', name: 'Precision Path Labs', location: 'Delhi', address: '4 Nehru Place', city: 'Delhi', state: 'Delhi', pincode: '110019', reg: 'DL-CLE-2021-1180', nabl: false, markup: 0.9 },
];

const SLOT_TIMES: readonly (readonly [start: string, end: string])[] = [
  ['09:00', '09:30'], ['10:00', '10:30'], ['11:00', '11:30'],
  ['14:00', '14:30'], ['15:30', '16:00'], ['16:30', '17:00'],
];

const nextDays = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

const yearsFromNow = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d;
};

/** Never listed for online sale, so partners must not carry them in stock. */
const isSellable = (schedule: DrugSchedule) =>
  schedule !== 'SCHEDULE_X' && schedule !== 'NARCOTIC';

async function main() {
  console.log('Seeding Health Buddy database...');

  for (const m of MEDICINES) {
    const existing = await prisma.medicine.findFirst({ where: { name: m.name } });
    if (existing) await prisma.medicine.update({ where: { id: existing.id }, data: m });
    else await prisma.medicine.create({ data: m });
  }
  console.log(`  medicines:    ${MEDICINES.length}`);

  for (const p of LAB_PACKAGES) {
    const existing = await prisma.labPackage.findFirst({ where: { testName: p.testName } });
    if (existing) await prisma.labPackage.update({ where: { id: existing.id }, data: p });
    else await prisma.labPackage.create({ data: p });
  }
  console.log(`  lab packages: ${LAB_PACKAGES.length}`);

  const dates = nextDays(7);
  for (const d of DOCTORS) {
    const user = await prisma.user.upsert({
      where: { phoneNumber: d.phone },
      update: { role: 'DOCTOR' },
      create: { phoneNumber: d.phone, role: 'DOCTOR' },
    });

    const profile = {
      name: d.name,
      specialty: d.specialty,
      qualification: d.qualification,
      experienceYears: d.experienceYears,
      consultationFee: d.consultationFee,
      rating: d.rating,
      clinicAddress: d.clinicAddress,
      councilRegistrationNumber: d.reg,
      councilName: 'National Medical Commission',
      verifiedAt: new Date(),
    };

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });

    for (const date of dates) {
      for (const [startTime, endTime] of SLOT_TIMES) {
        await prisma.doctorSlot.upsert({
          where: { doctorId_date_startTime: { doctorId: doctor.id, date, startTime } },
          update: {},
          create: { doctorId: doctor.id, date, startTime, endTime },
        });
      }
    }
  }
  console.log(`  doctors:      ${DOCTORS.length} (${dates.length} days x ${SLOT_TIMES.length} slots each)`);

  // Two of each partner, priced differently — the whole point of per-partner
  // inventory is that a single global price cannot represent this.
  const catalogue = await prisma.medicine.findMany();

  for (const p of PHARMACIES) {
    const user = await prisma.user.upsert({
      where: { phoneNumber: p.phone },
      update: { role: 'PHARMACY' },
      create: { phoneNumber: p.phone, role: 'PHARMACY' },
    });

    const profile = {
      name: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      pincode: p.pincode,
      drugLicenceNumber: p.licence,
      drugLicenceExpiry: yearsFromNow(2),
      isActive: true,
      verifiedAt: new Date(),
    };

    const pharmacy = await prisma.pharmacy.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });

    for (const med of catalogue.filter((m) => isSellable(m.schedule))) {
      await prisma.pharmacyInventory.upsert({
        where: {
          pharmacyId_medicineId: { pharmacyId: pharmacy.id, medicineId: med.id },
        },
        update: {},
        create: {
          pharmacyId: pharmacy.id,
          medicineId: med.id,
          price: Math.round(med.price * p.markup),
          stock: med.stock,
          reorderLevel: 20,
        },
      });
    }
  }

  const packages = await prisma.labPackage.findMany();

  for (const l of LABS) {
    const user = await prisma.user.upsert({
      where: { phoneNumber: l.phone },
      update: { role: 'LAB_PARTNER' },
      create: { phoneNumber: l.phone, role: 'LAB_PARTNER' },
    });

    const profile = {
      name: l.name,
      location: l.location,
      address: l.address,
      city: l.city,
      state: l.state,
      pincode: l.pincode,
      labRegistrationNumber: l.reg,
      nablAccredited: l.nabl,
      nablCertNumber: l.nablCert ?? null,
      nablExpiry: l.nabl ? yearsFromNow(3) : null,
      homeCollection: true,
      isActive: true,
      verifiedAt: new Date(),
    };

    const lab = await prisma.labPartner.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });

    for (const pkg of packages) {
      await prisma.labOffering.upsert({
        where: {
          labPartnerId_labPackageId: { labPartnerId: lab.id, labPackageId: pkg.id },
        },
        update: {},
        create: {
          labPartnerId: lab.id,
          labPackageId: pkg.id,
          price: Math.round(pkg.price * l.markup),
          homeCollectionFee: l.nabl ? 0 : 99,
          turnaroundHours: l.nabl ? 24 : 36,
        },
      });
    }
  }

  await prisma.user.upsert({
    where: { phoneNumber: '+15559000001' },
    update: { role: 'ADMIN' },
    create: { phoneNumber: '+15559000001', role: 'ADMIN' },
  });

  const sellable = catalogue.filter((m) => isSellable(m.schedule)).length;
  console.log(`  pharmacies:   ${PHARMACIES.length} (${sellable} stocked items each)`);
  console.log(`  labs:         ${LABS.length} (${packages.length} offerings each)`);
  console.log('  admins:       1');
  console.log('\nSeed complete.');
  console.log('  Admin login:    +15559000001');
  console.log('  Pharmacy login: +15552000001 / +15552000002');
  console.log('  Lab login:      +15553000001 / +15553000002');
  console.log('  Doctor login:   +15551000001');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
