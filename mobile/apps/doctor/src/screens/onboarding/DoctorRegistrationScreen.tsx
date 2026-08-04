import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import {
  Button,
  Card,
  DocumentUploader,
  Icon,
  Input,
  Screen,
  SectionHeader,
  Text,
  TopBar,
  colors,
  errorMessage,
  fetchMyApplications,
  radius,
  saveApplication,
  spacing,
  submitApplication,
  useAuth,
  type ProviderApplication,
} from '@healthbuddy/shared';

/**
 * Practice registration.
 *
 * Two things to keep in mind when editing this screen:
 *
 *  1. Nothing here grants a role. The form produces an application that an
 *     admin reviews; approval is what creates the doctor profile.
 *  2. The council registration number is not decoration — the Telemedicine
 *     Practice Guidelines require it on every prescription the doctor issues,
 *     and it is stamped onto each prescription at the moment it is written.
 */
export const DoctorRegistrationScreen: React.FC<{ onSubmitted: () => void }> = ({
  onSubmitted,
}) => {
  const { signOut } = useAuth();

  const [application, setApplication] = useState<ProviderApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    displayName: '',
    contactEmail: '',
    councilRegistrationNumber: '',
    councilName: '',
    hprId: '',
    qualification: '',
    specialty: '',
    experienceYears: '',
    consultationFee: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  });

  const load = useCallback(async () => {
    try {
      const all = await fetchMyApplications();
      const existing = all.find((a) => a.type === 'DOCTOR') ?? null;
      setApplication(existing);

      if (existing) {
        setForm({
          displayName: existing.displayName ?? '',
          contactEmail: existing.contactEmail ?? '',
          councilRegistrationNumber: existing.councilRegistrationNumber ?? '',
          councilName: existing.councilName ?? '',
          hprId: existing.hprId ?? '',
          qualification: existing.qualification ?? '',
          specialty: existing.specialty ?? '',
          experienceYears: existing.experienceYears?.toString() ?? '',
          consultationFee: existing.consultationFee?.toString() ?? '',
          address: existing.address ?? '',
          city: existing.city ?? '',
          state: existing.state ?? '',
          pincode: existing.pincode ?? '',
        });
      }
    } catch {
      /* first-time applicants simply have nothing to load */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.displayName.trim().length < 3) next.displayName = 'Enter your full name as registered.';
    if (!form.councilRegistrationNumber.trim())
      next.councilRegistrationNumber = 'Your council registration number is required.';
    if (!form.qualification.trim()) next.qualification = 'Enter your qualification.';
    if (!form.specialty.trim()) next.specialty = 'Enter your specialty.';
    if (!form.consultationFee.trim() || Number.isNaN(Number(form.consultationFee)))
      next.consultationFee = 'Enter your consultation fee.';
    if (form.address.trim().length < 5) next.address = 'Enter your clinic address.';
    if (form.contactEmail && !/^\S+@\S+\.\S+$/.test(form.contactEmail))
      next.contactEmail = 'Enter a valid email.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Persists as a DRAFT so documents can be attached before review. */
  const save = async (): Promise<ProviderApplication | null> => {
    if (!validate()) return null;

    setSaving(true);
    try {
      const saved = await saveApplication({
        type: 'DOCTOR',
        displayName: form.displayName.trim(),
        address: form.address.trim(),
        ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.state.trim() ? { state: form.state.trim() } : {}),
        ...(form.pincode.trim() ? { pincode: form.pincode.trim() } : {}),
        ...(form.hprId.trim() ? { hprId: form.hprId.trim() } : {}),
        councilRegistrationNumber: form.councilRegistrationNumber.trim(),
        ...(form.councilName.trim() ? { councilName: form.councilName.trim() } : {}),
        qualification: form.qualification.trim(),
        specialty: form.specialty.trim(),
        ...(form.experienceYears ? { experienceYears: Number(form.experienceYears) } : {}),
        consultationFee: Number(form.consultationFee),
      });
      setApplication(saved);
      return saved;
    } catch (err) {
      Alert.alert('Could not save', errorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const saved = (await save()) ?? application;
    if (!saved) return;

    // The server re-checks completeness; this only avoids a pointless round trip.
    if (!saved.documents.some((d) => d.kind === 'DOCTOR_REGISTRATION_CERT')) {
      Alert.alert(
        'Registration certificate required',
        'Attach your council registration certificate before submitting.'
      );
      return;
    }

    setSaving(true);
    try {
      await submitApplication('DOCTOR');
      onSubmitted();
    } catch (err) {
      Alert.alert('Could not submit', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const docsOf = (kind: ProviderApplication['documents'][number]['kind']) =>
    application?.documents.filter((d) => d.kind === kind) ?? [];

  if (loading) return null;

  return (
    <Screen scroll>
      <TopBar
        brand
        right={<Button label="Sign out" variant="ghost" size="sm" onPress={() => void signOut()} />}
      />

      <View style={styles.hero}>
        <View style={styles.iconAnchor}>
          <Icon name="stethoscope" size={30} color={colors.primary} />
        </View>
        <Text variant="displayBold" color={colors.headingDark}>
          Register your practice
        </Text>
        <Text variant="bodyMd" color={colors.captionGray}>
          We verify every practitioner against their medical council registration before they can
          consult on Health Buddy.
        </Text>
      </View>

      <SectionHeader title="About you" />
      <Card style={styles.section}>
        <Input
          label="Full name (as registered)"
          icon="person"
          placeholder="Dr. Priya Sharma"
          value={form.displayName}
          onChangeText={set('displayName')}
          error={errors.displayName}
          autoCapitalize="words"
        />
        <Input
          label="Email"
          icon="mail"
          placeholder="you@clinic.in"
          value={form.contactEmail}
          onChangeText={set('contactEmail')}
          error={errors.contactEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Qualification"
          icon="school"
          placeholder="MBBS, MD (General Medicine)"
          value={form.qualification}
          onChangeText={set('qualification')}
          error={errors.qualification}
        />
        <Input
          label="Specialty"
          icon="medical_services"
          placeholder="General Physician"
          value={form.specialty}
          onChangeText={set('specialty')}
          error={errors.specialty}
        />
        <Input
          label="Years of experience"
          icon="timeline"
          placeholder="10"
          value={form.experienceYears}
          onChangeText={set('experienceYears')}
          keyboardType="number-pad"
        />
      </Card>

      <SectionHeader title="Medical registration" />
      <Card style={styles.section}>
        <Input
          label="Council registration number"
          icon="badge"
          placeholder="MH-2013-104521"
          value={form.councilRegistrationNumber}
          onChangeText={set('councilRegistrationNumber')}
          error={errors.councilRegistrationNumber}
          autoCapitalize="characters"
          hint="Printed on every prescription you issue, as the guidelines require."
        />
        <Input
          label="Issuing council"
          icon="account_balance"
          placeholder="Maharashtra Medical Council"
          value={form.councilName}
          onChangeText={set('councilName')}
        />
        <Input
          label="HPR ID (optional)"
          icon="fingerprint"
          placeholder="Healthcare Professionals Registry ID"
          value={form.hprId}
          onChangeText={set('hprId')}
          autoCapitalize="none"
          hint="Speeds up verification — we can check it against the ABDM registry."
        />
      </Card>

      <SectionHeader title="Consultation" />
      <Card style={styles.section}>
        <Input
          label="Consultation fee (₹)"
          icon="payments"
          placeholder="500"
          value={form.consultationFee}
          onChangeText={set('consultationFee')}
          error={errors.consultationFee}
          keyboardType="decimal-pad"
        />
        <Input
          label="Clinic address"
          icon="location_on"
          placeholder="Wellness Medical Hub, Andheri West"
          value={form.address}
          onChangeText={set('address')}
          error={errors.address}
          multiline
        />
        <Input label="City" icon="location_city" value={form.city} onChangeText={set('city')} />
        <Input label="State" icon="map" value={form.state} onChangeText={set('state')} />
        <Input
          label="PIN code"
          icon="pin_drop"
          value={form.pincode}
          onChangeText={set('pincode')}
          keyboardType="number-pad"
          maxLength={6}
        />
      </Card>

      <SectionHeader title="Documents" />
      {!application ? (
        <Card background={colors.infoLight} style={styles.notice}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            Save your details first — then you can attach your certificates.
          </Text>
        </Card>
      ) : (
        <View style={styles.section}>
          <DocumentUploader
            label="Council registration certificate"
            hint="A photo or PDF of the certificate issued by your medical council."
            kind="DOCTOR_REGISTRATION_CERT"
            applicationId={application.id}
            documents={docsOf('DOCTOR_REGISTRATION_CERT')}
            onChange={() => void load()}
            required
          />
          <DocumentUploader
            label="Degree certificate"
            hint="Your highest medical qualification."
            kind="DOCTOR_QUALIFICATION"
            applicationId={application.id}
            documents={docsOf('DOCTOR_QUALIFICATION')}
            onChange={() => void load()}
          />
          <DocumentUploader
            label="Photo ID"
            hint="Aadhaar, passport or driving licence."
            kind="ID_PROOF"
            applicationId={application.id}
            documents={docsOf('ID_PROOF')}
            onChange={() => void load()}
          />
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label={application ? 'Save changes' : 'Save and continue'}
          variant="outline"
          onPress={() => void save()}
          loading={saving}
          fullWidth
        />
        {application ? (
          <Button
            label="Submit for verification"
            icon="send"
            iconPosition="right"
            onPress={() => void submit()}
            loading={saving}
            fullWidth
          />
        ) : null}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: spacing.base, paddingBottom: spacing.lg },
  iconAnchor: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  section: { gap: spacing.insetPage },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  actions: { gap: spacing.insetCard, marginTop: spacing.xl },
});
