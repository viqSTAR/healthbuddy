import {
  PrismaClient,
  type DeliverySpeed,
  type DrugSchedule,
  type TeleDrugList,
} from '@prisma/client';

const prisma = new PrismaClient();

const DOCTORS = [
  { phone: '+15551000001', name: 'Dr. Aisha Mehta', specialty: 'Cardiologist', qualification: 'MBBS, MD (Cardiology)', experienceYears: 12, consultationFee: 750, rating: 4.9, clinicAddress: 'Heart Care Center, 5th Avenue', reg: 'MH-2013-104521', clinicCity: 'Mumbai', clinicState: 'Maharashtra', clinicPincode: '400058', latitude: 19.1364, longitude: 72.8296 },
  { phone: '+15551000002', name: 'Dr. Nisha Rao', specialty: 'Dermatologist', qualification: 'MBBS, MD (Dermatology)', experienceYears: 8, consultationFee: 600, rating: 4.8, clinicAddress: 'Skin & Aesthetics Clinic', reg: 'MH-2017-118834', clinicCity: 'Mumbai', clinicState: 'Maharashtra', clinicPincode: '400053', latitude: 19.1400, longitude: 72.8250 },
  { phone: '+15551000003', name: 'Dr. Priya Sharma', specialty: 'General Physician', qualification: 'MBBS, MD (General Medicine)', experienceYears: 15, consultationFee: 500, rating: 5.0, clinicAddress: 'Wellness Medical Hub', reg: 'DL-2010-091277', clinicCity: 'Delhi', clinicState: 'Delhi', clinicPincode: '110009', latitude: 28.7158, longitude: 77.1910 },
  { phone: '+15551000004', name: 'Dr. Robert Chen', specialty: 'Pediatrician', qualification: 'MBBS, DCH', experienceYears: 10, consultationFee: 650, rating: 4.9, clinicAddress: 'Kids First Health Center', reg: 'KA-2015-143902', clinicCity: 'Bengaluru', clinicState: 'Karnataka', clinicPincode: '560001', latitude: 12.9716, longitude: 77.5946 },
  { phone: '+15551000005', name: 'Dr. Marcus Vance', specialty: 'Orthopedic', qualification: 'MBBS, MS (Ortho)', experienceYears: 14, consultationFee: 800, rating: 4.7, clinicAddress: 'Bone & Joint Institute', reg: 'TN-2011-076615', clinicCity: 'Chennai', clinicState: 'Tamil Nadu', clinicPincode: '600001', latitude: 13.0827, longitude: 80.2707 },
  { phone: '+15551000006', name: 'Dr. Leena Kapoor', specialty: 'Neurologist', qualification: 'MBBS, DM (Neurology)', experienceYears: 11, consultationFee: 900, rating: 4.8, clinicAddress: 'NeuroCare Specialty Clinic', reg: 'MH-2014-129048', clinicCity: 'Mumbai', clinicState: 'Maharashtra', clinicPincode: '400076', latitude: 19.1176, longitude: 72.9060 },
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
  /// Express is opt-in per medicine. Anything needing cold chain, controlled
  /// handling or a pharmacist's check stays STANDARD.
  deliverySpeed: DeliverySpeed;
}[] = [
  { name: 'Paracetamol 500mg', deliverySpeed: 'EXPRESS', category: 'Pain Relief', price: 25, stock: 250, description: 'Relieves mild to moderate fever and pain.', composition: 'Paracetamol IP 500mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Cetirizine 10mg', deliverySpeed: 'EXPRESS', category: 'Allergy', price: 32, stock: 300, description: '24-hour allergy relief from sneezing and runny nose.', composition: 'Cetirizine Hydrochloride IP 10mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Vitamin C 1000mg', deliverySpeed: 'EXPRESS', category: 'Supplements', price: 149, stock: 500, description: 'Immunity booster chewable tablets.', composition: 'Ascorbic Acid 1000mg', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Oral Rehydration Salts', deliverySpeed: 'EXPRESS', category: 'Digestive Health', price: 22, stock: 400, description: 'Restores fluid and electrolyte balance.', composition: 'ORS WHO formula', schedule: 'OTC', teleList: 'LIST_O', requiresPrescription: false },
  { name: 'Ibuprofen 400mg', deliverySpeed: 'STANDARD', category: 'Pain Relief', price: 48, stock: 220, description: 'Anti-inflammatory for pain and swelling.', composition: 'Ibuprofen IP 400mg', schedule: 'SCHEDULE_H', teleList: 'LIST_A', requiresPrescription: true },
  { name: 'Omeprazole 20mg', deliverySpeed: 'STANDARD', category: 'Digestive Health', price: 86, stock: 150, description: 'Relief from acid reflux and heartburn.', composition: 'Omeprazole IP 20mg', schedule: 'SCHEDULE_H', teleList: 'LIST_A', requiresPrescription: true },
  { name: 'Amoxicillin 250mg', deliverySpeed: 'STANDARD', category: 'Antibiotics', price: 112, stock: 100, description: 'Broad-spectrum antibiotic for bacterial infections.', composition: 'Amoxicillin Trihydrate IP 250mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Metformin 500mg', deliverySpeed: 'STANDARD', category: 'Diabetes', price: 74, stock: 180, description: 'Controls blood sugar in type 2 diabetes.', composition: 'Metformin Hydrochloride IP 500mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Aspirin 75mg', deliverySpeed: 'STANDARD', category: 'Cardiac', price: 38, stock: 400, description: 'Low-dose blood thinner for heart health.', composition: 'Acetylsalicylic Acid IP 75mg', schedule: 'SCHEDULE_H', teleList: 'LIST_B', requiresPrescription: true },
  { name: 'Alprazolam 0.25mg', deliverySpeed: 'STANDARD', category: 'Psychiatry', price: 55, stock: 0, description: 'Anxiolytic. Cannot be sold or prescribed online.', composition: 'Alprazolam IP 0.25mg', schedule: 'SCHEDULE_X', teleList: 'PROHIBITED', requiresPrescription: true },
  { name: 'Tramadol 50mg', deliverySpeed: 'STANDARD', category: 'Pain Relief', price: 68, stock: 0, description: 'Opioid analgesic. Cannot be sold or prescribed online.', composition: 'Tramadol Hydrochloride IP 50mg', schedule: 'NARCOTIC', teleList: 'PROHIBITED', requiresPrescription: true },
];

/**
 * `deliveryMode` decides what the lab owes at the end, and `homeCollection`
 * whether a phlebotomist can come to the patient. The imaging rows exist so the
 * two paths that are not "a PDF arrives" are exercised by real data: an X-ray
 * produces a report plus a study, and its film is a physical object that has to
 * travel — which makes it a parcel, not a download.
 */
const LAB_PACKAGES = [
  { testName: 'Full Body Health Checkup', category: 'Preventive Care', price: 1999, sampleType: 'Blood & Urine', fastingReq: true, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Lipid Profile & Cholesterol Test', category: 'Cardiology', price: 699, sampleType: 'Blood', fastingReq: true, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Thyroid Stimulating Hormone (TSH)', category: 'Endocrinology', price: 449, sampleType: 'Blood', fastingReq: false, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Complete Blood Count (CBC)', category: 'General', price: 349, sampleType: 'Blood', fastingReq: false, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'HbA1c Diabetes Monitoring', category: 'Diabetology', price: 549, sampleType: 'Blood', fastingReq: false, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Vitamin D Total', category: 'Nutrition', price: 1299, sampleType: 'Blood', fastingReq: false, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Liver Function Test (LFT)', category: 'Gastroenterology', price: 799, sampleType: 'Blood', fastingReq: true, deliveryMode: 'DIGITAL_REPORT' as const, homeCollection: true },
  { testName: 'Chest X-Ray (PA view)', category: 'Radiology', price: 599, sampleType: 'Imaging', fastingReq: false, deliveryMode: 'PHYSICAL' as const, homeCollection: false },
  { testName: 'CT Scan — Abdomen', category: 'Radiology', price: 4499, sampleType: 'Imaging', fastingReq: true, deliveryMode: 'DIGITAL_IMAGING' as const, homeCollection: false },
];

/**
 * `serves` is the list of pincodes each shop delivers to, and it is what decides
 * whether the store opens at all for a given address.
 *
 * The two Mumbai shops deliberately overlap on 400058 and stock different
 * things: QuickMeds carries only the fast-moving over-the-counter lines, so a
 * basket of paracetamol plus an antibiotic is sourced from two shops and
 * becomes two shipments. Without an overlap like this, every order would resolve
 * to a single pharmacy and the split would never be exercised.
 */
const PHARMACIES = [
  {
    phone: '+15552000001', name: 'Health Buddy Central Pharmacy',
    address: '221 Wellness Road, Andheri West', city: 'Mumbai', state: 'Maharashtra',
    pincode: '400058', licence: 'MH-RTL-20-114523', markup: 1.0,
    serves: ['400058', '400053', '400061', '400076'],
    stocksEverything: true,
  },
  {
    phone: '+15552000002', name: 'CarePlus Chemists',
    address: '14 Model Town, Sector 9', city: 'Delhi', state: 'Delhi',
    pincode: '110009', licence: 'DL-RTL-20-089114', markup: 0.94,
    serves: ['110009', '110007', '110033'],
    stocksEverything: true,
  },
  {
    phone: '+15552000003', name: 'QuickMeds Andheri',
    address: '7 Lokhandwala Complex, Andheri West', city: 'Mumbai', state: 'Maharashtra',
    pincode: '400053', licence: 'MH-RTL-21-160882', markup: 0.88,
    serves: ['400058', '400053'],
    // Cheapest on the shelf, but only carries what turns over quickly.
    stocksEverything: false,
  },
];

const LABS = [
  { phone: '+15553000001', name: 'Health Buddy Diagnostics', location: 'Mumbai', address: '88 Lab Street, Powai', city: 'Mumbai', state: 'Maharashtra', pincode: '400076', reg: 'MH-CLE-2019-4412', nabl: true, nablCert: 'MC-3387', markup: 1.0 },
  { phone: '+15553000002', name: 'Precision Path Labs', location: 'Delhi', address: '4 Nehru Place', city: 'Delhi', state: 'Delhi', pincode: '110019', reg: 'DL-CLE-2021-1180', nabl: false, markup: 0.9 },
];

/**
 * National emergency numbers, plus a couple of city listings to show how the
 * area lookup behaves. National entries always surface, so the SOS screen is
 * never empty even where there are no local records.
 */
const EMERGENCY_SERVICES = [
  { name: 'Ambulance (National)', type: 'AMBULANCE' as const, phone: '108', isNational: true, notes: 'Free emergency ambulance across most states.' },
  { name: 'Emergency Response (All-in-one)', type: 'AMBULANCE' as const, phone: '112', isNational: true, notes: 'Police, fire and medical from a single number.' },
  { name: 'Maternity & Child Ambulance', type: 'AMBULANCE' as const, phone: '102', isNational: true, notes: 'Free transport for pregnant women and infants.' },
  { name: 'National Health Helpline', type: 'POISON_CONTROL' as const, phone: '104', isNational: true, notes: 'Medical advice and poison guidance.' },
  { name: 'Tele-MANAS Mental Health', type: 'MENTAL_HEALTH' as const, phone: '14416', isNational: true, notes: '24x7 mental health support.' },
  { name: 'Lifeline Blood Bank', type: 'BLOOD_BANK' as const, phone: '+912226551234', city: 'Mumbai', state: 'Maharashtra', pincode: '400058', latitude: 19.1364, longitude: 72.8296, address: '12 Andheri West' },
  { name: 'City General Hospital', type: 'HOSPITAL' as const, phone: '+912226559876', city: 'Mumbai', state: 'Maharashtra', pincode: '400076', latitude: 19.1176, longitude: 72.9060, address: 'Powai Main Road' },
  { name: 'Capital Blood Centre', type: 'BLOOD_BANK' as const, phone: '+911126553311', city: 'Delhi', state: 'Delhi', pincode: '110019', latitude: 28.5494, longitude: 77.2500, address: '4 Nehru Place' },
];

/**
 * Condition-matched health content. `matchValues` are compared against the
 * patient's own chronic conditions, allergies or recent diagnoses — a diabetes
 * tip reaches diabetics, not everybody.
 */
const HEALTH_TIPS = [
  { title: 'Check your feet daily', body: 'Diabetes can dull sensation in the feet, so a small cut can go unnoticed and become serious. Look at the soles and between the toes once a day, and see a doctor about anything that has not started healing in three days.', category: 'Diabetes', audience: 'CONDITION' as const, matchValues: ['diabetes', 'diabetic'], priority: 10 },
  { title: 'Salt is the lever that moves blood pressure', body: 'Most of the salt we eat comes from packaged food rather than the shaker. Cutting back on namkeen, pickles and packaged soups usually lowers blood pressure more than cooking with less salt does.', category: 'Hypertension', audience: 'CONDITION' as const, matchValues: ['hypertension', 'blood pressure', 'bp'], priority: 10 },
  { title: 'Keep a reliever inhaler within reach', body: 'Asthma attacks rarely announce themselves. Keep your reliever inhaler where you can reach it in seconds — bedside, bag, desk — and replace it before it runs out, not after.', category: 'Asthma', audience: 'CONDITION' as const, matchValues: ['asthma'], priority: 10 },
  { title: 'Finish the whole antibiotic course', body: 'Stopping antibiotics once you feel better lets the strongest bacteria survive, and those are the ones that come back harder to treat. Finish the course your doctor prescribed even if the symptoms have gone.', category: 'Medication', audience: 'DIAGNOSIS' as const, matchValues: ['infection', 'pharyngitis', 'bronchitis', 'uti'], priority: 8 },
  { title: 'Carry your allergy list', body: 'In an emergency you may not be able to speak for yourself. Keep your allergies written in your phone and in your wallet, so whoever treats you knows what to avoid.', category: 'Allergy', audience: 'ALLERGY' as const, matchValues: ['penicillin', 'sulfa', 'peanut', 'dust', 'pollen'], priority: 9 },
  { title: 'Drink before you feel thirsty', body: 'Thirst lags behind dehydration, especially in Indian summers. Aim for pale-yellow urine as the marker rather than counting glasses.', category: 'General', audience: 'EVERYONE' as const, matchValues: [], priority: 1 },
  { title: 'A yearly check-up is cheaper than a diagnosis', body: 'After 40, an annual blood panel catches things like high cholesterol and early diabetes while they are still easy to manage.', category: 'Preventive', audience: 'AGE_RANGE' as const, matchValues: [], minAge: 40, priority: 5 },
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
      clinicCity: d.clinicCity,
      clinicState: d.clinicState,
      clinicPincode: d.clinicPincode,
      latitude: d.latitude,
      longitude: d.longitude,
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

    for (const pincode of p.serves) {
      await prisma.pharmacyServiceArea.upsert({
        where: { pharmacyId_pincode: { pharmacyId: pharmacy.id, pincode } },
        update: {},
        create: { pharmacyId: pharmacy.id, pincode },
      });
    }

    const shelf = catalogue
      .filter((m) => isSellable(m.schedule))
      .filter((m) => p.stocksEverything || m.deliverySpeed === 'EXPRESS');

    for (const med of shelf) {
      await prisma.pharmacyInventory.upsert({
        where: {
          pharmacyId_medicineId: { pharmacyId: pharmacy.id, medicineId: med.id },
        },
        update: {},
        create: {
          pharmacyId: pharmacy.id,
          medicineId: med.id,
          price: Math.round(Number(med.price) * p.markup),
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

    // A capability, not a price list. Labs differ in equipment, so which tests
    // they run is theirs to decide; the price is set per area below.
    for (const pkg of packages) {
      await prisma.labOffering.upsert({
        where: {
          labPartnerId_labPackageId: { labPartnerId: lab.id, labPackageId: pkg.id },
        },
        update: {},
        create: {
          labPartnerId: lab.id,
          labPackageId: pkg.id,
          turnaroundHours: l.nabl ? 24 : 36,
        },
      });
    }
  }

  /**
   * Area price bands.
   *
   * A national row every test falls back to, plus two city bands so the
   * most-specific-wins resolution is exercised by the seed data: the same test
   * costs more in Mumbai than in Delhi, and identically at every lab within
   * each city.
   */
  const PRICE_BANDS: { state: string; city: string; factor: number; collection: number }[] = [
    { state: '', city: '', factor: 1.0, collection: 99 },
    { state: 'Maharashtra', city: 'Mumbai', factor: 1.15, collection: 0 },
    { state: 'Delhi', city: 'Delhi', factor: 0.9, collection: 49 },
  ];

  for (const pkg of packages) {
    for (const band of PRICE_BANDS) {
      await prisma.labTestPrice.upsert({
        where: {
          labPackageId_state_city: {
            labPackageId: pkg.id,
            state: band.state,
            city: band.city,
          },
        },
        update: {},
        create: {
          labPackageId: pkg.id,
          state: band.state,
          city: band.city,
          price: Math.round(Number(pkg.price) * band.factor),
          homeCollectionFee: band.collection,
          note: band.city ? `${band.city} rate` : 'National standard rate',
        },
      });
    }
  }

  for (const service of EMERGENCY_SERVICES) {
    const existing = await prisma.emergencyService.findFirst({
      where: { name: service.name, phone: service.phone },
    });
    if (existing) await prisma.emergencyService.update({ where: { id: existing.id }, data: service });
    else await prisma.emergencyService.create({ data: service });
  }

  for (const tip of HEALTH_TIPS) {
    const existing = await prisma.healthTip.findFirst({ where: { title: tip.title } });
    if (existing) await prisma.healthTip.update({ where: { id: existing.id }, data: tip });
    else await prisma.healthTip.create({ data: tip });
  }

  await prisma.user.upsert({
    where: { phoneNumber: '+15559000001' },
    update: { role: 'ADMIN' },
    create: { phoneNumber: '+15559000001', role: 'ADMIN' },
  });

  const sellable = catalogue.filter((m) => isSellable(m.schedule)).length;
  console.log(`  pharmacies:   ${PHARMACIES.length} (${sellable} stocked items each)`);
  console.log(`  labs:         ${LABS.length} (${packages.length} offerings each)`);
  console.log(`  emergency:    ${EMERGENCY_SERVICES.length} services`);
  console.log(`  health tips:  ${HEALTH_TIPS.length}`);
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
