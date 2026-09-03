import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { Card } from './Card';
import { Button } from './Button';
import { Screen, TopBar } from './Screen';
import { EmptyState, Loading, ErrorState } from './EmptyState';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';
import { useAsync } from '../hooks/useAsync';
import { isExpoGo, syncNotificationBadge } from '../services/notifications';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../services/endpoints';

const ICONS: Record<string, string> = {
  APPLICATION_SUBMITTED: 'assignment',
  APPLICATION_APPROVED: 'verified',
  APPLICATION_REJECTED: 'error',
  APPOINTMENT_BOOKED: 'event',
  APPOINTMENT_CANCELLED: 'event_busy',
  CONSULT_READY: 'videocam',
  PRESCRIPTION_ISSUED: 'prescriptions',
  ORDER_PLACED: 'shopping_bag',
  ORDER_STATUS_CHANGED: 'local_shipping',
  LAB_BOOKED: 'science',
  LAB_REPORT_READY: 'description',
  LOW_STOCK: 'inventory',
  SOS_RAISED: 'emergency',
  GENERIC: 'notifications',
};

const relative = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

/**
 * In-app notification feed. Push delivery is best-effort — this list is the
 * durable record, so a partner who had notifications switched off still finds
 * out an order arrived.
 */
export const NotificationsScreen: React.FC<{
  navigation: { goBack: () => void };
  /** Lets each app route a tapped notification to its own screens. */
  onOpen?: (notification: AppNotification) => void;
}> = ({ navigation, onOpen }) => {
  const feed = useAsync(() => fetchNotifications({ page: 1 }), []);

  /**
   * The feed is the only place that knows the true unread count, so it is the
   * place that owns the iOS app-icon badge. Runs on every load and after each
   * optimistic read below, which is what keeps the badge from outliving the
   * notifications it was counting.
   */
  const unreadCount = feed.data?.unread;
  useEffect(() => {
    if (unreadCount === undefined) return;
    void syncNotificationBadge(unreadCount);
  }, [unreadCount]);

  const open = async (notification: AppNotification) => {
    if (!notification.readAt) {
      // Optimistic — an unread badge that lingers after a tap reads as broken.
      feed.setData((prev) =>
        prev
          ? {
              ...prev,
              unread: Math.max(0, prev.unread - 1),
              notifications: prev.notifications.map((n) =>
                n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n
              ),
            }
          : prev!
      );
      await markNotificationRead(notification.id).catch(() => feed.reload());
    }
    onOpen?.(notification);
  };

  const markAll = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    feed.reload();
  };

  if (feed.loading) return <Loading label="Loading notifications" />;
  if (feed.error) return <ErrorState message={feed.error} onRetry={feed.reload} />;

  const { notifications, unread } = feed.data!;

  return (
    <Screen scroll refreshing={feed.refreshing} onRefresh={feed.refresh}>
      <TopBar
        title="Notifications"
        onBack={navigation.goBack}
        right={
          unread > 0 ? (
            <Button label="Mark all read" variant="ghost" size="sm" onPress={() => void markAll()} />
          ) : undefined
        }
      />

      {/*
        Expo Go dropped remote push on Android in SDK 53. Say so plainly rather
        than letting someone conclude notifications are broken — this list is
        the durable record and still works, only the device banner is missing.
      */}
      {isExpoGo ? (
        <Card background={colors.infoLight} style={styles.notice}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.noticeText}>
            Push banners need a development build — Expo Go cannot receive them. This list still
            updates normally.
          </Text>
        </Card>
      ) : null}

      {notifications.length === 0 ? (
        <EmptyState
          icon="notifications_off"
          title="Nothing yet"
          message="Updates about your account will appear here."
        />
      ) : (
        <View style={styles.list}>
          {notifications.map((notification) => (
            <Pressable key={notification.id} onPress={() => void open(notification)}>
              <Card style={[styles.row, !notification.readAt && styles.unread]}>
                <View style={styles.iconBox}>
                  <Icon
                    name={ICONS[notification.type] ?? 'notifications'}
                    size={20}
                    color={colors.primary}
                  />
                </View>

                <View style={styles.body}>
                  <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                    {notification.title}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {notification.body}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {relative(notification.createdAt)}
                  </Text>
                </View>

                {!notification.readAt ? <View style={styles.dot} /> : null}
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    marginBottom: spacing.insetCard,
  },
  noticeText: { flex: 1 },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  unread: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: spacing.base,
  },
});
