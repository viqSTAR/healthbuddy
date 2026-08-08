import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  colors,
  createSlots,
  deleteSlot,
  EmptyState,
  errorMessage,
  ErrorState,
  fetchMySchedule,
  Icon,
  Input,
  Loading,
  radius,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAsync,
} from '@healthbuddy/shared';

const DAYS_AHEAD = 14;

const dayList = () =>
  Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: d.getDate(),
    };
  });

/**
 * Availability management — the thing a doctor could not do at all before this
 * app existed, because slots were only ever created by the seed script.
 */
export const ScheduleScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const days = useMemo(dayList, []);
  const [selected, setSelected] = useState(days[0]!.date);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [slotMinutes, setSlotMinutes] = useState('30');
  const [busy, setBusy] = useState(false);

  const schedule = useAsync(
    () => fetchMySchedule(days[0]!.date, days[days.length - 1]!.date),
    [days]
  );

  const slotsForDay = (schedule.data ?? []).filter((s) => s.date === selected);

  const generate = async () => {
    setBusy(true);
    try {
      const result = await createSlots({
        date: selected,
        startTime,
        endTime,
        slotMinutes: Number(slotMinutes) || 30,
      });
      schedule.reload();
      Alert.alert(
        'Availability updated',
        result.skipped > 0
          ? `${result.created} slot(s) added. ${result.skipped} already existed and were left as they are.`
          : `${result.created} slot(s) added.`
      );
    } catch (err) {
      Alert.alert('Could not add slots', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (slotId: string, booked: boolean) => {
    if (booked) {
      Alert.alert(
        'Slot is booked',
        'Cancel the appointment first — removing it here would strand the patient.'
      );
      return;
    }

    Alert.alert('Remove slot', 'Remove this time from your availability?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSlot(slotId);
            schedule.reload();
          } catch (err) {
            Alert.alert('Could not remove', errorMessage(err));
          }
        },
      },
    ]);
  };

  if (schedule.loading) return <Loading label="Loading your schedule" />;
  if (schedule.error) return <ErrorState message={schedule.error} onRetry={schedule.reload} />;

  return (
    <Screen scroll refreshing={schedule.refreshing} onRefresh={schedule.refresh}>
      <TopBar title="Availability" onBack={() => navigation.goBack()} />

      <ChipRow>
        {days.map((d) => (
          <Chip
            key={d.date}
            label={`${d.weekday} ${d.day}`}
            selected={d.date === selected}
            onPress={() => setSelected(d.date)}
          />
        ))}
      </ChipRow>

      <SectionHeader title="Add consulting hours" />
      <Card style={styles.form}>
        <View style={styles.times}>
          <Input
            label="From"
            icon="schedule"
            value={startTime}
            onChangeText={setStartTime}
            placeholder="09:00"
            containerStyle={styles.flex}
          />
          <Input
            label="To"
            icon="schedule"
            value={endTime}
            onChangeText={setEndTime}
            placeholder="13:00"
            containerStyle={styles.flex}
          />
        </View>

        <View>
          <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
            Slot length
          </Text>
          <View style={styles.durations}>
            {['15', '20', '30', '45', '60'].map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes} min`}
                selected={minutes === slotMinutes}
                onPress={() => setSlotMinutes(minutes)}
              />
            ))}
          </View>
        </View>

        <Button
          label="Generate slots"
          icon="add"
          onPress={() => void generate()}
          loading={busy}
          fullWidth
        />
      </Card>

      <SectionHeader title={`Slots on ${selected}`} />

      {slotsForDay.length === 0 ? (
        <EmptyState
          icon="event_busy"
          title="No slots yet"
          message="Add consulting hours above and patients will be able to book them."
        />
      ) : (
        <View style={styles.grid}>
          {slotsForDay.map((slot) => {
            const booked = slot.status !== 'AVAILABLE';
            return (
              <Pressable
                key={slot.id}
                onPress={() =>
                  booked && slot.appointment
                    ? navigation.navigate('Consultation', { appointmentId: slot.appointment.id })
                    : remove(slot.id, booked)
                }
                style={({ pressed }) => [
                  styles.slot,
                  booked && styles.slotBooked,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  variant="labelMd"
                  weight="semibold"
                  color={booked ? colors.onPrimary : colors.onSurface}
                >
                  {slot.startTime}
                </Text>
                <Text
                  variant="captionSm"
                  color={booked ? colors.primaryFixed : colors.captionGray}
                  numberOfLines={1}
                >
                  {booked ? (slot.appointment?.patient.fullName ?? 'Booked') : 'Free'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.legend}>
        <Badge label="Tap a free slot to remove it" tint="neutral" icon="info" />
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.insetPage },
  times: { flexDirection: 'row', gap: spacing.insetCard },
  durations: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base, marginTop: spacing.base },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.insetCard },
  slot: {
    minWidth: 96,
    flexGrow: 1,
    paddingVertical: spacing.insetCard,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    gap: 2,
  },
  slotBooked: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  legend: { alignItems: 'center', marginTop: spacing.insetPage },
});
