import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Badge,
  Card,
  colors,
  Icon,
  ListRow,
  radius,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAuth,
  useProviderApplication,
} from '@healthbuddy/shared';

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
};

export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const { application } = useProviderApplication(['PHARMACY', 'LAB']);

  const isPharmacy = user?.role === 'PHARMACY';

  // Surfaced here because an expired licence auto-suspends the account — the
  // partner should see it coming rather than discover it when orders stop.
  const licenceExpiry = isPharmacy ? application?.drugLicenceExpiry : application?.nablExpiry;
  const remaining = daysUntil(licenceExpiry ?? null);
  const expiringSoon = remaining !== null && remaining <= 30;

  return (
    <Screen scroll>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.header}>
        <View style={styles.iconBox}>
          <Icon
            name={isPharmacy ? 'local_pharmacy' : 'science'}
            size={28}
            color={colors.primary}
          />
        </View>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {application?.displayName ?? user?.fullName ?? 'Partner'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {isPharmacy ? 'Pharmacy' : 'Diagnostic lab'} · {user?.phoneNumber}
          </Text>
          <View style={styles.badges}>
            <Badge label="Verified" tint="success" icon="verified" />
            {application?.nablAccredited ? <Badge label="NABL" tint="info" /> : null}
          </View>
        </View>
      </Card>

      {expiringSoon ? (
        <Card
          background={remaining! <= 0 ? colors.dangerLight : colors.warningLight}
          style={styles.warning}
        >
          <Icon
            name="warning"
            size={20}
            color={remaining! <= 0 ? colors.error : colors.warningDark}
          />
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
        <ListRow icon="location_on" title="Address" subtitle={application?.address ?? '—'} />
        <ListRow icon="location_city" title="City" value={application?.city ?? '—'} />
        {isPharmacy ? (
          <>
            <ListRow
              icon="verified_user"
              title="Drug licence"
              value={application?.drugLicenceNumber ?? '—'}
            />
            <ListRow
              icon="person"
              title="Pharmacist"
              value={application?.pharmacistName ?? '—'}
              last
            />
          </>
        ) : (
          <>
            <ListRow
              icon="verified_user"
              title="Lab registration"
              value={application?.labRegistrationNumber ?? '—'}
            />
            <ListRow
              icon="home_pin"
              title="Home collection"
              value={application?.homeCollection ? 'Offered' : 'Not offered'}
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
        <ListRow
          icon="logout"
          title="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out', 'Sign out of Health Buddy Partner?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
          last
        />
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
