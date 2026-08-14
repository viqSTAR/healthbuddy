import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  Text,
  colors,
  rupees,
  spacing,
  type Doctor,
} from '@healthbuddy/shared';

/** Compact bento tile — the "Top Doctors" card on the home screen. */
export const DoctorTile: React.FC<{ doctor: Doctor; onPress?: () => void }> = ({
  doctor,
  onPress,
}) => (
  <Card size="cardSm" padding={spacing.insetCard} onPress={onPress} style={styles.tile}>
    <View style={styles.tileTop}>
      <Avatar name={doctor.name} size={38} tint="info" />
      <Badge label="Verified" icon="verified" emphasis="verified" />
    </View>

    <View>
      <Text variant="labelMd" weight="medium" color={colors.headingDark} numberOfLines={1}>
        {doctor.name}
      </Text>
      <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
        {doctor.specialty}
      </Text>
    </View>

    <View style={styles.ratingRow}>
      <Icon name="star" size={12} color={colors.primary} />
      <Text variant="captionSm" weight="medium" color={colors.onSurfaceVariant}>
        {doctor.rating.toFixed(1)} · {doctor.isAvailable ? 'Available today' : 'Unavailable'}
      </Text>
    </View>
  </Card>
);

/** Full-width row used by the doctor directory and search results. */
export const DoctorRow: React.FC<{
  doctor: Doctor;
  onPress?: () => void;
  onBook?: () => void;
}> = ({ doctor, onPress, onBook }) => (
  <Card size="cardSm" padding={spacing.insetCard} onPress={onPress}>
    <View style={styles.row}>
      <Avatar name={doctor.name} size={56} tint="success" />

      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text variant="headlineSmMobile" color={colors.headingDark} numberOfLines={1}>
            {doctor.name}
          </Text>
          <Icon name="verified" size={14} color={colors.successDark} />
        </View>

        <Text variant="captionSm" color={colors.captionGray}>
          {doctor.specialty} · {doctor.experienceYears} yrs exp
          {/* Only present on an in-person search, so its absence is meaningful
              rather than missing data. */}
          {typeof doctor.distanceKm === 'number' ? ` · ${doctor.distanceKm} km` : ''}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Icon name="star" size={12} color={colors.primary} />
            <Text variant="captionSm" weight="medium" color={colors.onSurfaceVariant}>
              {doctor.rating.toFixed(1)}
            </Text>
          </View>
          <Text variant="captionSm" weight="semibold" color={colors.primary}>
            {rupees(doctor.consultationFee)}
          </Text>
        </View>
      </View>

      {onBook ? <Button label="Book" size="sm" onPress={onBook} /> : null}
    </View>
  </Card>
);

const styles = StyleSheet.create({
  tile: { flex: 1, gap: spacing.base },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.inlineSm, marginTop: 'auto' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  rowBody: { flex: 1, gap: spacing.stackTight },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.inlineSm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
