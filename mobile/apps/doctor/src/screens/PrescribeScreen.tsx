import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  colors,
  createPrescription,
  errorMessage,
  ErrorState,
  fetchLabPackages,
  fetchPrescribableMedicines,
  Icon,
  Input,
  Loading,
  radius,
  Screen,
  SearchBar,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAsync,
  type LabPackage,
  type PrescribableMedicine,
} from '@healthbuddy/shared';

interface Line {
  medicineId?: string;
  name: string;
  dosage: string;
  frequency: string;
  durationDays?: number;
  instructions?: string;
}

interface TestLine {
  labPackageId: string;
  testName: string;
  instructions?: string;
  urgent?: boolean;
}

const TELE_LABEL: Record<PrescribableMedicine['teleList'], string> = {
  LIST_O: 'List O',
  LIST_A: 'List A',
  LIST_B: 'List B',
  PROHIBITED: 'Prohibited',
};

/**
 * The prescribing screen.
 *
 * The drug picker is filtered by the server for THIS appointment: each entry
 * comes back marked prescribable or refused, with the reason. Refused drugs are
 * shown greyed with their reason rather than hidden, so the doctor understands
 * why an option is unavailable instead of assuming the catalogue is incomplete.
 *
 * The same rules are enforced again on submit — the filter here is a courtesy,
 * not the control.
 */
export const PrescribeScreen: React.FC<{ route: any; navigation: any }> = ({
  route,
  navigation,
}) => {
  const { appointmentId } = route.params as { appointmentId: string };

  const [search, setSearch] = useState('');
  const catalogue = useAsync(() => fetchPrescribableMedicines(appointmentId), [appointmentId]);

  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [advice, setAdvice] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [tests, setTests] = useState<TestLine[]>([]);
  const [saving, setSaving] = useState(false);

  // Catalogue tests can be auto-booked through the patient's consent flow;
  // that is why ordering one here matters rather than writing it in the advice.
  const labCatalogue = useAsync(() => fetchLabPackages(), []);

  const addMedicine = (medicine: PrescribableMedicine) => {
    if (!medicine.prescribable) {
      Alert.alert('Cannot prescribe', medicine.reason ?? 'This medicine is not available here.');
      return;
    }
    if (lines.some((l) => l.medicineId === medicine.id)) return;

    setLines((prev) => [
      ...prev,
      { medicineId: medicine.id, name: medicine.name, dosage: '1 tablet', frequency: 'Twice daily' },
    ]);
  };

  const updateLine = (index: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const submit = async () => {
    if (diagnosis.trim().length < 3) {
      Alert.alert('Diagnosis required', 'Enter a diagnosis before issuing the prescription.');
      return;
    }
    if (lines.length === 0) {
      Alert.alert('No medicines', 'Add at least one medicine.');
      return;
    }
    if (lines.some((l) => !l.dosage.trim() || !l.frequency.trim())) {
      Alert.alert('Incomplete', 'Every medicine needs a dosage and frequency.');
      return;
    }

    setSaving(true);
    try {
      await createPrescription({
        appointmentId,
        diagnosis: diagnosis.trim(),
        medicines: lines,
        ...(tests.length ? { labTests: tests } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(advice.trim() ? { advice: advice.trim() } : {}),
      });
      Alert.alert(
        'Prescription issued',
        'The patient has been sent a priced basket to approve. Nothing is ordered until they do.',
        [
          { text: 'Done', onPress: () => navigation.popToTop() },
        ]
      );
    } catch (err) {
      Alert.alert('Could not issue prescription', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (catalogue.loading) return <Loading label="Loading medicines" />;
  if (catalogue.error) return <ErrorState message={catalogue.error} onRetry={catalogue.reload} />;

  const data = catalogue.data!;
  const visible = data.medicines.filter((m) =>
    m.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <Screen scroll>
      <TopBar title="New prescription" onBack={() => navigation.goBack()} />

      <Card
        background={data.isFollowUp ? colors.successLight : colors.warningLight}
        style={styles.context}
      >
        <Icon
          name="gavel"
          size={18}
          color={data.isFollowUp ? colors.successDark : colors.warningDark}
        />
        <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
          {data.consultationMode === 'IN_PERSON'
            ? 'In-person consultation — the telemedicine drug lists do not restrict this prescription.'
            : data.isFollowUp
              ? 'Follow-up video consult — List O, A and B are all available.'
              : 'First video consult — List B medicines require a follow-up and are locked.'}
        </Text>
      </Card>

      <SectionHeader title="Diagnosis" />
      <Card style={styles.section}>
        <Input
          label="Diagnosis"
          icon="clinical_notes"
          placeholder="Acute viral pharyngitis"
          value={diagnosis}
          onChangeText={setDiagnosis}
          multiline
        />
      </Card>

      <SectionHeader title={`Medicines (${lines.length})`} />

      {lines.map((line, index) => (
        <Card key={`${line.medicineId ?? line.name}-${index}`} style={styles.lineCard}>
          <View style={styles.lineHeader}>
            <Text variant="labelMd" weight="bold" color={colors.onSurface} style={styles.flex}>
              {line.name}
            </Text>
            <Pressable onPress={() => removeLine(index)} hitSlop={10}>
              <Icon name="delete" size={18} color={colors.error} />
            </Pressable>
          </View>

          <View style={styles.lineRow}>
            <Input
              label="Dosage"
              value={line.dosage}
              onChangeText={(v) => updateLine(index, { dosage: v })}
              placeholder="1 tablet"
              containerStyle={styles.flex}
            />
            <Input
              label="Frequency"
              value={line.frequency}
              onChangeText={(v) => updateLine(index, { frequency: v })}
              placeholder="Twice daily"
              containerStyle={styles.flex}
            />
          </View>

          <View style={styles.lineRow}>
            <Input
              label="Duration (days)"
              value={line.durationDays?.toString() ?? ''}
              onChangeText={(v) =>
                updateLine(index, { durationDays: v ? Number(v) : undefined })
              }
              keyboardType="number-pad"
              placeholder="5"
              containerStyle={styles.flex}
            />
            <Input
              label="Instructions"
              value={line.instructions ?? ''}
              onChangeText={(v) => updateLine(index, { instructions: v })}
              placeholder="After food"
              containerStyle={styles.flex}
            />
          </View>
        </Card>
      ))}

      <SectionHeader title="Add from catalogue" />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search medicines" />

      <View style={styles.catalogue}>
        {visible.map((medicine) => (
          <Pressable
            key={medicine.id}
            onPress={() => addMedicine(medicine)}
            style={({ pressed }) => [
              styles.medicine,
              !medicine.prescribable && styles.medicineLocked,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.flex}>
              <Text
                variant="labelMd"
                weight="semibold"
                color={medicine.prescribable ? colors.onSurface : colors.captionGray}
              >
                {medicine.name}
              </Text>
              <Text variant="captionSm" color={colors.captionGray} numberOfLines={2}>
                {medicine.reason ?? medicine.composition ?? medicine.category}
              </Text>
            </View>

            <View style={styles.medicineTags}>
              <Badge
                label={TELE_LABEL[medicine.teleList]}
                tint={
                  medicine.teleList === 'LIST_O'
                    ? 'success'
                    : medicine.teleList === 'LIST_A'
                      ? 'info'
                      : medicine.teleList === 'LIST_B'
                        ? 'warning'
                        : 'danger'
                }
              />
              <Icon
                name={medicine.prescribable ? 'add_circle' : 'lock'}
                size={20}
                color={medicine.prescribable ? colors.primary : colors.captionGray}
              />
            </View>
          </Pressable>
        ))}
      </View>

      <SectionHeader title={`Lab tests (${tests.length})`} />
      {tests.map((test, index) => (
        <Card key={test.labPackageId} style={styles.lineCard}>
          <View style={styles.lineHeader}>
            <Text variant="labelMd" weight="bold" color={colors.onSurface} style={styles.flex}>
              {test.testName}
            </Text>
            <Pressable
              onPress={() => setTests((prev) => prev.filter((_, i) => i !== index))}
              hitSlop={10}
            >
              <Icon name="delete" size={18} color={colors.error} />
            </Pressable>
          </View>
          <View style={styles.lineRow}>
            <Input
              label="Instructions"
              value={test.instructions ?? ''}
              onChangeText={(v) =>
                setTests((prev) =>
                  prev.map((t, i) => (i === index ? { ...t, instructions: v } : t))
                )
              }
              placeholder="Fasting sample"
              containerStyle={styles.flex}
            />
          </View>
          <Pressable
            onPress={() =>
              setTests((prev) => prev.map((t, i) => (i === index ? { ...t, urgent: !t.urgent } : t)))
            }
          >
            <Badge
              label={test.urgent ? 'Urgent' : 'Routine'}
              tint={test.urgent ? 'danger' : 'neutral'}
            />
          </Pressable>
        </Card>
      ))}

      <View style={styles.catalogue}>
        {(labCatalogue.data?.packages ?? [])
          .filter((pkg: LabPackage) => !tests.some((t) => t.labPackageId === pkg.id))
          .slice(0, 8)
          .map((pkg: LabPackage) => (
            <Pressable
              key={pkg.id}
              onPress={() =>
                setTests((prev) => [...prev, { labPackageId: pkg.id, testName: pkg.testName }])
              }
              style={({ pressed }) => [styles.medicine, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  {pkg.testName}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {pkg.sampleType}
                  {pkg.fastingReq ? ' · fasting required' : ''}
                </Text>
              </View>
              <Icon name="add_circle" size={20} color={colors.primary} />
            </Pressable>
          ))}
      </View>

      <SectionHeader title="Advice" />
      <Card style={styles.section}>
        <Input
          label="Advice to the patient"
          icon="tips_and_updates"
          placeholder="Rest, plenty of fluids, review if fever persists beyond 3 days."
          value={advice}
          onChangeText={setAdvice}
          multiline
        />
        <Input
          label="Private notes"
          icon="lock"
          placeholder="Not shown to the patient"
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </Card>

      <View style={styles.actions}>
        <Button
          label="Issue prescription"
          icon="check_circle"
          iconPosition="right"
          onPress={() => void submit()}
          loading={saving}
          fullWidth
        />
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  context: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  section: { gap: spacing.insetPage },
  lineCard: { gap: spacing.insetCard, marginBottom: spacing.insetCard },
  lineHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  lineRow: { flexDirection: 'row', gap: spacing.insetCard },
  catalogue: { gap: spacing.base, marginTop: spacing.insetCard },
  medicine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  medicineLocked: { backgroundColor: colors.surfaceContainerLow, opacity: 0.85 },
  medicineTags: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  pressed: { opacity: 0.8 },
  actions: { marginTop: spacing.xl },
});
