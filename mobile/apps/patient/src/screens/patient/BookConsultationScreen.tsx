import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert, TextInput } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  Text,
  TopBar,
  bookAppointment,
  colors,
  errorMessage,
  fetchDoctor,
  fetchDoctorSlots,
  radius,
  spacing,
  typography,
  useAsync,
} from '@healthbuddy/shared';

const nextDays = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: d.getDate(),
    };
  });

/** Mirrors `book_consultation` / `schedule_appointment`: date strip, slot grid, visit type. */
export const BookConsultationScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { doctorId } = route.params;
  const days = useMemo(() => nextDays(7), []);

  const [date, setDate] = useState(days[0]!.iso);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [type, setType] = useState<'VIDEO' | 'IN_PERSON'>('VIDEO');
  const [symptoms, setSymptoms] = useState('');
  const [booking, setBooking] = useState(false);

  const doctor = useAsync(() => fetchDoctor(doctorId), [doctorId]);
  const slots = useAsync(() => fetchDoctorSlots(doctorId, date), [doctorId, date]);

  const available = slots.data?.filter((s) => s.status === 'AVAILABLE') ?? [];

  const confirm = async () => {
    if (!slotId) return;
    setBooking(true);
    try {
      const appointment = await bookAppointment({
        doctorId,
        slotId,
        type,
        symptoms: symptoms.trim() || undefined,
      });
      navigation.replace('AppointmentConfirmed', { appointment });
    } catch (err) {
      Alert.alert('Could not book', errorMessage(err));
      // Someone else may have taken the slot — refresh so the grid is truthful.
      slots.reload();
      setSlotId(null);
    } finally {
      setBooking(false);
    }
  };

  return (
    <>
      <Screen padded={false} bottomInset={110}>
        <TopBar title="Book Consultation" onBack={navigation.goBack} />

        <View style={styles.page}>
          {doctor.data ? (
            <Card style={styles.doctorCard}>
              <Avatar name={doctor.data.name} size={52} tint="success" />
              <View style={styles.flex}>
                <Text variant="headlineSmMobile" color={colors.headingDark}>
                  {doctor.data.name}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {doctor.data.specialty} · ${doctor.data.consultationFee.toFixed(2)}
                </Text>
              </View>
            </Card>
          ) : null}

          <View style={styles.section}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Select Date
            </Text>
            <View style={styles.dateStrip}>
              {days.map((d) => {
                const selected = d.iso === date;
                return (
                  <Pressable
                    key={d.iso}
                    onPress={() => {
                      setDate(d.iso);
                      setSlotId(null);
                    }}
                    style={[styles.dateCell, selected && styles.dateCellActive]}
                  >
                    <Text
                      variant="captionSm"
                      color={selected ? colors.onPrimary : colors.captionGray}
                    >
                      {d.weekday}
                    </Text>
                    <Text
                      variant="headlineSmMobile"
                      color={selected ? colors.onPrimary : colors.headingDark}
                    >
                      {d.day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Available Slots
            </Text>

            {slots.loading ? (
              <Loading />
            ) : slots.error ? (
              <ErrorState message={slots.error} onRetry={slots.reload} />
            ) : available.length === 0 ? (
              <EmptyState
                icon="event_busy"
                title="No slots left"
                message="Every slot for this day is taken. Try another date."
              />
            ) : (
              <View style={styles.slotGrid}>
                {available.map((slot) => {
                  const selected = slot.id === slotId;
                  return (
                    <Pressable
                      key={slot.id}
                      onPress={() => setSlotId(slot.id)}
                      style={[styles.slot, selected && styles.slotActive]}
                    >
                      <Text
                        variant="labelMd"
                        weight="medium"
                        color={selected ? colors.onPrimary : colors.headingDark}
                      >
                        {slot.startTime}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Visit Type
            </Text>
            <View style={styles.typeRow}>
              <TypeOption
                icon="videocam"
                label="Video visit"
                selected={type === 'VIDEO'}
                onPress={() => setType('VIDEO')}
              />
              <TypeOption
                icon="hospital_building"
                label="In person"
                selected={type === 'IN_PERSON'}
                onPress={() => setType('IN_PERSON')}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Reason for visit
            </Text>
            <Card padding={spacing.insetCard}>
              <TextInput
                style={styles.textArea}
                placeholder="Describe your symptoms (optional)"
                placeholderTextColor={colors.captionGray}
                value={symptoms}
                onChangeText={setSymptoms}
                multiline
                numberOfLines={4}
                maxLength={1000}
                textAlignVertical="top"
              />
            </Card>
          </View>
        </View>
      </Screen>

      <View style={styles.footer}>
        <Button
          label={slotId ? 'Confirm Booking' : 'Select a slot'}
          fullWidth
          disabled={!slotId}
          loading={booking}
          onPress={confirm}
        />
      </View>
    </>
  );
};

const TypeOption: React.FC<{
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ icon, label, selected, onPress }) => (
  <Pressable onPress={onPress} style={[styles.typeOption, selected && styles.typeOptionActive]}>
    <Icon name={icon} size={22} color={selected ? colors.primary : colors.captionGray} />
    <Text
      variant="labelMd"
      weight="medium"
      color={selected ? colors.primary : colors.onSurfaceVariant}
    >
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.xl },
  doctorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  flex: { flex: 1 },
  section: { gap: spacing.insetCard },
  dateStrip: { flexDirection: 'row', gap: spacing.base },
  dateCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.stackTight,
    paddingVertical: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
  },
  dateCellActive: { backgroundColor: colors.primary },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base },
  slot: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  slotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeRow: { flexDirection: 'row', gap: spacing.insetCard },
  typeOption: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.insetPage,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeOptionActive: { borderColor: colors.primary, backgroundColor: colors.successLight },
  textArea: { ...typography.bodyMd, color: colors.onSurface, minHeight: 88, padding: 0 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.insetPage,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
});
