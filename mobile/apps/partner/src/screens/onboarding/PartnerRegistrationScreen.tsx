import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Switch } from 'react-native';
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
  type ApplicationType,
  type DocumentKind,
  type ProviderApplication,
} from '@healthbuddy/shared';

/**
 * Shop registration.
 *
 * A pharmacy and a lab are different businesses with different regulators, so
 * the form genuinely diverges: a pharmacy supplies a state drug licence and its
 * pharmacist's details, a lab supplies its clinical-establishment registration
 * and optional NABL accreditation. The shared shell keeps the business identity
 * fields and the document flow identical.
 */
export const PartnerRegistrationScreen: React.FC<{
  type: ApplicationType;
  onSubmitted: () => void;
  onBack: () => void;
}> = ({ type, onSubmitted, onBack }) => {
  const isPharmacy = type === 'PHARMACY';

  const [application, setApplication] = useState<ProviderApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    displayName: '',
    contactEmail: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    hfrId: '',
    // Pharmacy
    drugLicenceNumber: '',
    drugLicenceExpiry: '',
    gstin: '',
    pharmacistName: '',
    pharmacistRegNumber: '',
    // Lab
    labRegistrationNumber: '',
    nablCertNumber: '',
    nablExpiry: '',
  });
  const [nablAccredited, setNablAccredited] = useState(false);
  const [homeCollection, setHomeCollection] = useState(true);

  const load = useCallback(async () => {
    try {
      const all = await fetchMyApplications();
      const existing = all.find((a) => a.type === type) ?? null;
      setApplication(existing);

      if (existing) {
        setForm({
          displayName: existing.displayName ?? '',
          contactEmail: existing.contactEmail ?? '',
          address: existing.address ?? '',
          city: existing.city ?? '',
          state: existing.state ?? '',
          pincode: existing.pincode ?? '',
          hfrId: existing.hfrId ?? '',
          drugLicenceNumber: existing.drugLicenceNumber ?? '',
          drugLicenceExpiry: existing.drugLicenceExpiry?.slice(0, 10) ?? '',
          gstin: existing.gstin ?? '',
          pharmacistName: existing.pharmacistName ?? '',
          pharmacistRegNumber: existing.pharmacistRegNumber ?? '',
          labRegistrationNumber: existing.labRegistrationNumber ?? '',
          nablCertNumber: existing.nablCertNumber ?? '',
          nablExpiry: existing.nablExpiry?.slice(0, 10) ?? '',
        });
        setNablAccredited(existing.nablAccredited);
        setHomeCollection(existing.homeCollection);
      }
    } catch {
      /* nothing to restore on a first application */
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.displayName.trim().length < 3) next.displayName = 'Enter your registered business name.';
    if (form.address.trim().length < 5) next.address = 'Enter the shop address.';
    if (form.contactEmail && !/^\S+@\S+\.\S+$/.test(form.contactEmail))
      next.contactEmail = 'Enter a valid email.';

    if (isPharmacy) {
      if (!form.drugLicenceNumber.trim())
        next.drugLicenceNumber = 'Your retail drug licence number is required.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.drugLicenceExpiry))
        next.drugLicenceExpiry = 'Enter the expiry as YYYY-MM-DD.';
    } else {
      if (!form.labRegistrationNumber.trim())
        next.labRegistrationNumber = 'Your lab registration number is required.';
      if (nablAccredited && !form.nablCertNumber.trim())
        next.nablCertNumber = 'Enter your NABL certificate number.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (): Promise<ProviderApplication | null> => {
    if (!validate()) return null;

    setSaving(true);
    try {
      const saved = await saveApplication({
        type,
        displayName: form.displayName.trim(),
        address: form.address.trim(),
        ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.state.trim() ? { state: form.state.trim() } : {}),
        ...(form.pincode.trim() ? { pincode: form.pincode.trim() } : {}),
        ...(form.hfrId.trim() ? { hfrId: form.hfrId.trim() } : {}),
        ...(isPharmacy
          ? {
              drugLicenceNumber: form.drugLicenceNumber.trim(),
              drugLicenceExpiry: form.drugLicenceExpiry,
              ...(form.gstin.trim() ? { gstin: form.gstin.trim() } : {}),
              ...(form.pharmacistName.trim() ? { pharmacistName: form.pharmacistName.trim() } : {}),
              ...(form.pharmacistRegNumber.trim()
                ? { pharmacistRegNumber: form.pharmacistRegNumber.trim() }
                : {}),
            }
          : {
              labRegistrationNumber: form.labRegistrationNumber.trim(),
              nablAccredited,
              ...(form.nablCertNumber.trim() ? { nablCertNumber: form.nablCertNumber.trim() } : {}),
              ...(form.nablExpiry ? { nablExpiry: form.nablExpiry } : {}),
              homeCollection,
            }),
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

  const requiredDoc: DocumentKind = isPharmacy ? 'DRUG_LICENCE' : 'LAB_REGISTRATION';

  const submit = async () => {
    const saved = (await save()) ?? application;
    if (!saved) return;

    if (!saved.documents.some((d) => d.kind === requiredDoc)) {
      Alert.alert(
        isPharmacy ? 'Drug licence required' : 'Lab registration required',
        'Attach the document before submitting for review.'
      );
      return;
    }

    setSaving(true);
    try {
      await submitApplication(type);
      onSubmitted();
    } catch (err) {
      Alert.alert('Could not submit', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const docsOf = (kind: DocumentKind) =>
    application?.documents.filter((d) => d.kind === kind) ?? [];

  if (loading) return null;

  return (
    <Screen scroll>
      <TopBar title={isPharmacy ? 'Register pharmacy' : 'Register lab'} onBack={onBack} />

      <View style={styles.hero}>
        <View style={styles.iconAnchor}>
          <Icon name={isPharmacy ? 'local_pharmacy' : 'science'} size={30} color={colors.primary} />
        </View>
        <Text variant="bodyMd" color={colors.captionGray}>
          {isPharmacy
            ? 'Health Buddy is a marketplace — you hold the drug licence and dispense; we route orders to you.'
            : 'Tell us about your lab so patients can book tests and receive reports securely.'}
        </Text>
      </View>

      <SectionHeader title="Business details" />
      <Card style={styles.section}>
        <Input
          label={isPharmacy ? 'Pharmacy name' : 'Lab name'}
          icon="storefront"
          placeholder={isPharmacy ? 'CarePlus Chemists' : 'Precision Path Labs'}
          value={form.displayName}
          onChangeText={set('displayName')}
          error={errors.displayName}
        />
        <Input
          label="Email"
          icon="mail"
          placeholder="owner@business.in"
          value={form.contactEmail}
          onChangeText={set('contactEmail')}
          error={errors.contactEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Address"
          icon="location_on"
          placeholder="14 Model Town, Sector 9"
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
        <Input
          label="HFR ID (optional)"
          icon="fingerprint"
          placeholder="Health Facility Registry ID"
          value={form.hfrId}
          onChangeText={set('hfrId')}
          autoCapitalize="none"
          hint="Speeds up verification — we can check it against the ABDM registry."
        />
      </Card>

      {isPharmacy ? (
        <>
          <SectionHeader title="Licensing" />
          <Card style={styles.section}>
            <Input
              label="Retail drug licence number"
              icon="verified_user"
              placeholder="MH-RTL-20-114523"
              value={form.drugLicenceNumber}
              onChangeText={set('drugLicenceNumber')}
              error={errors.drugLicenceNumber}
              autoCapitalize="characters"
            />
            <Input
              label="Licence expiry"
              icon="event"
              placeholder="2030-01-01"
              value={form.drugLicenceExpiry}
              onChangeText={set('drugLicenceExpiry')}
              error={errors.drugLicenceExpiry}
              hint="Your account is suspended automatically once the licence lapses."
            />
            <Input
              label="GSTIN (optional)"
              icon="receipt_long"
              value={form.gstin}
              onChangeText={set('gstin')}
              autoCapitalize="characters"
            />
            <Input
              label="Registered pharmacist"
              icon="person"
              placeholder="Name of the supervising pharmacist"
              value={form.pharmacistName}
              onChangeText={set('pharmacistName')}
            />
            <Input
              label="Pharmacist registration number"
              icon="badge"
              value={form.pharmacistRegNumber}
              onChangeText={set('pharmacistRegNumber')}
              autoCapitalize="characters"
            />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Accreditation" />
          <Card style={styles.section}>
            <Input
              label="Lab registration number"
              icon="verified_user"
              placeholder="MH-CLE-2019-4412"
              value={form.labRegistrationNumber}
              onChangeText={set('labRegistrationNumber')}
              error={errors.labRegistrationNumber}
              autoCapitalize="characters"
            />

            <View style={styles.toggle}>
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  NABL accredited
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  Accredited labs are highlighted to patients.
                </Text>
              </View>
              <Switch
                value={nablAccredited}
                onValueChange={setNablAccredited}
                trackColor={{ true: colors.primary, false: colors.outlineVariant }}
                thumbColor={colors.surfaceContainerLowest}
              />
            </View>

            {nablAccredited ? (
              <>
                <Input
                  label="NABL certificate number"
                  icon="workspace_premium"
                  value={form.nablCertNumber}
                  onChangeText={set('nablCertNumber')}
                  error={errors.nablCertNumber}
                  autoCapitalize="characters"
                />
                <Input
                  label="NABL expiry"
                  icon="event"
                  placeholder="2029-06-30"
                  value={form.nablExpiry}
                  onChangeText={set('nablExpiry')}
                />
              </>
            ) : null}

            <View style={styles.toggle}>
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  Home sample collection
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  Your staff collect samples from the patient's address.
                </Text>
              </View>
              <Switch
                value={homeCollection}
                onValueChange={setHomeCollection}
                trackColor={{ true: colors.primary, false: colors.outlineVariant }}
                thumbColor={colors.surfaceContainerLowest}
              />
            </View>
          </Card>
        </>
      )}

      <SectionHeader title="Documents" />
      {!application ? (
        <Card background={colors.infoLight} style={styles.notice}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            Save your details first — then you can attach your licence.
          </Text>
        </Card>
      ) : (
        <View style={styles.section}>
          <DocumentUploader
            label={isPharmacy ? 'Retail drug licence' : 'Lab registration certificate'}
            hint="A clear photo or PDF of the certificate."
            kind={requiredDoc}
            applicationId={application.id}
            documents={docsOf(requiredDoc)}
            onChange={() => void load()}
            required
          />
          {isPharmacy ? (
            <DocumentUploader
              label="Pharmacist certificate"
              hint="Registration certificate of the supervising pharmacist."
              kind="PHARMACIST_CERT"
              applicationId={application.id}
              documents={docsOf('PHARMACIST_CERT')}
              onChange={() => void load()}
            />
          ) : nablAccredited ? (
            <DocumentUploader
              label="NABL certificate"
              kind="NABL_CERTIFICATE"
              applicationId={application.id}
              documents={docsOf('NABL_CERTIFICATE')}
              onChange={() => void load()}
            />
          ) : null}
          <DocumentUploader
            label="GST certificate"
            kind="GST_CERTIFICATE"
            applicationId={application.id}
            documents={docsOf('GST_CERTIFICATE')}
            onChange={() => void load()}
          />
          <DocumentUploader
            label="Premises photo"
            hint="A photo of the shopfront helps us verify the address."
            kind="PREMISES_PHOTO"
            applicationId={application.id}
            documents={docsOf('PREMISES_PHOTO')}
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
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.insetPage },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  actions: { gap: spacing.insetCard, marginTop: spacing.xl },
});
