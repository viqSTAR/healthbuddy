import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Badge,
  Card,
  colors,
  ErrorState,
  fetchMyLab,
  fetchMyPharmacy,
  Icon,
  ListRow,
  Loading,
  radius,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAsync,
  useAuth,
  type MyLab,
  type MyPharmacy,
} from '@healthbuddy/shared';

/** The two profiles share a shell but only one of them holds a drug licence. */
const isPharmacyProfile = (p: MyPharmacy | MyLab): p is MyPharmacy => 'drugLicenceNumber' in p;

const daysUntil = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
};

/**
 * The partner's own record: who they are, what licence they hold, where they
 * work from.
 *
 * Read from the shop or lab row, not from the ProviderApplication. The
 * application is the form someone fills in to *ask* to become a partner; a
 * partner admitted any other way — the seed, or an admin provisioning them
 * directly — has none, and `useProviderApplication` does not even fetch one
 * once the role is granted. Every field on this screen therefore rendered as a
 * dash for exactly the partners who were verified and trading.
 */
export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const isPharmacy = user?.role === 'PHARMACY';

  const profile = useAsync<MyPharmacy | MyLab>(
    () => (isPharmacy ? fetchMyPharmacy() : fetchMyLab()),
    [isPharmacy]
  );

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'Sign out of Health Buddy Partner?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  if (profile.loading) return <Loading label="Loading your profile" />;
  if (profile.error || !profile.data) {
    return <ErrorState message={profile.error ?? 'Profile unavailable.'} onRetry={profile.reload} />;
  }

  const shop = profile.data;
  const pharmacy = isPharmacyProfile(shop) ? shop : null;
  const lab = isPharmacyProfile(shop) ? null : shop;

  // Surfaced here because an expired licence auto-suspends the account — the
  // partner should see it coming rather than discover it when orders stop.
  const remaining = daysUntil(pharmacy?.drugLicenceExpiry ?? lab?.nablExpiry);
  const expiringSoon = remaining !== null && remaining <= 30;

  const place = [shop.city, shop.state].filter(Boolean).join(', ');

  return (
    <Screen scroll refreshing={profile.refreshing} onRefresh={profile.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.header}>
        <View style={styles.iconBox}>
          <Icon name={isPharmacy ? 'local_pharmacy' : 'science'} size={28} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {shop.name}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {isPharmacy ? 'Pharmacy' : 'Diagnostic lab'} · {user?.phoneNumber}
          </Text>
          <View style={styles.badges}>
            {/* The verification date, not a hardcoded badge: an unverified
                partner should not be told it is verified. */}
            {shop.verifiedAt ? <Badge label="Verified" tint="success" icon="verified" /> : null}
            {lab?.nablAccredited ? <Badge label="NABL" tint="info" /> : null}
            {!shop.isActive ? <Badge label="Inactive" tint="danger" /> : null}
          </View>
        </View>
      </Card>

      {expiringSoon ? (
        <Card
          background={remaining! <= 0 ? colors.dangerLight : colors.warningLight}
          style={styles.warning}
        >
          <Icon name="warning" size={20} color={remaining! <= 0 ? colors.error : colors.warningDark} />
          <View style={styles.flex}>
            <Text
              variant="labelMd"
              weight="bold"
              color={remaining! <= 0 ? colors.error : colors.warningDark}
            >
              {remaining! <= 0 ? 'Licence expired' : `Licence expires in ${remaining} days`}
            </Text>
            <Text variant="captionSm" color={colors.onSurface}>
              {remaining! <= 0
                ? 'Your account has been suspended. Contact support with a renewed licence.'
                : 'Renew before it lapses — accounts are suspended automatically on expiry.'}
            </Text>
          </View>
        </Card>
      ) : null}

      <SectionHeader title="Business" />
      <Card padded={false}>
        <ListRow
          icon="location_on"
          title="Address"
          subtitle={shop.address ?? lab?.location ?? '—'}
        />
        <ListRow icon="location_city" title="City" value={place || '—'} />
        <ListRow icon="markunread_mailbox" title="Pincode" value={shop.pincode ?? '—'} />
        {pharmacy ? (
          <>
            <ListRow
              icon="verified_user"
              title="Drug licence"
              value={pharmacy.drugLicenceNumber ?? '—'}
            />
            <ListRow icon="receipt_long" title="GSTIN" value={pharmacy.gstin ?? '—'} />
            <ListRow
              icon="delivery_dining"
              title="Delivery radius"
              value={`${pharmacy.deliveryRadiusKm} km`}
            />
            <ListRow icon="person" title="Pharmacist" value={pharmacy.pharmacistName ?? '—'} last />
          </>
        ) : (
          <>
            <ListRow
              icon="verified_user"
              title="Lab registration"
              value={lab?.labRegistrationNumber ?? '—'}
            />
            <ListRow icon="workspace_premium" title="NABL certificate" value={lab?.nablCertNumber ?? '—'} />
            <ListRow
              icon="home_pin"
              title="Home collection"
              value={lab?.homeCollection ? 'Offered' : 'Not offered'}
              last
            />
          </>
        )}
      </Card>

      <SectionHeader title="Account" />
      <Card padded={false}>
        <ListRow
          icon="account_balance"
          iconTint="success"
          title="Earnings"
          subtitle="Your share of every completed order"
          onPress={() => navigation.navigate('Earnings')}
          showChevron
        />
        <ListRow
          icon="notifications"
          iconTint="warning"
          title="Notifications"
          onPress={() => navigation.navigate('Notifications')}
          showChevron
        />
        <ListRow icon="logout" title="Sign out" danger onPress={confirmSignOut} last />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', gap: spacing.stackMedium, marginTop: spacing.base },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
});
