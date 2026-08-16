import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, AppState } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { Screen, TopBar } from './Screen';
import { EmptyState, Loading, ErrorState } from './EmptyState';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../services/auth';
import { fetchChatThreads, type ChatThreadSummary } from '../services/endpoints';

/** Slower than the conversation's poll — a list only needs to feel current. */
const POLL_MS = 20_000;

const relative = (iso: string) => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};

export interface ChatThreadsScreenProps {
  navigation: any;
  role: 'PATIENT' | 'DOCTOR';
  /** Route to push for one conversation. */
  conversationRoute?: string;
  /**
   * Whether to offer a back arrow. Explicit rather than inferred from
   * `canGoBack()`: as a tab this is a root screen with nothing to go back to,
   * but the tab navigator still reports the previously selected tab as history,
   * which put a back arrow on a bottom-tab destination.
   */
  showBack?: boolean;
}

/**
 * Every follow-up conversation this user is a party to.
 *
 * Threads are opened by the server when a consultation completes, so there is
 * no "start a chat" action here by design: a channel to a doctor that anyone
 * could open on demand is a consultation without one.
 */
export const ChatThreadsScreen: React.FC<ChatThreadsScreenProps> = ({
  navigation,
  role,
  conversationRoute = 'ChatConversation',
  showBack = true,
}) => {
  const { user } = useAuth();
  const threads = useAsync(fetchChatThreads, []);
  const refresh = threads.refresh;

  // Kept in a ref so the polling effect does not re-subscribe on every render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /**
   * Re-read whenever this screen comes back into view.
   *
   * Coming back from a conversation is when the list is most likely to be
   * wrong: messages were just read, and a doctor may have closed or reopened
   * the thread. Waiting for the next poll left the row showing "Closed" for
   * twenty seconds after it had been reopened. Uses the navigation prop's own
   * listener rather than `useFocusEffect` so this package keeps no dependency
   * on react-navigation.
   */
  useEffect(() => {
    const unsubscribe = navigation?.addListener?.('focus', () => refreshRef.current());
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => refreshRef.current(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Catch up immediately on return, then resume the slow poll.
        refreshRef.current();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, []);

  const open = useCallback(
    (thread: ChatThreadSummary) => {
      const name =
        role === 'DOCTOR'
          ? (thread.patient?.fullName ?? 'Patient')
          : (thread.doctor?.name ?? 'Your doctor');

      navigation.navigate(conversationRoute, {
        threadId: thread.id,
        title: name,
        subtitle: role === 'DOCTOR' ? 'Follow-up chat' : (thread.doctor?.specialty ?? 'Follow-up chat'),
      });
    },
    [navigation, role, conversationRoute]
  );

  if (threads.loading) return <Loading label="Loading messages" />;
  if (threads.error) return <ErrorState message={threads.error} onRetry={threads.reload} />;

  const list = threads.data ?? [];

  return (
    <Screen scroll refreshing={threads.refreshing} onRefresh={threads.refresh}>
      <TopBar title="Messages" onBack={showBack ? navigation.goBack : undefined} />

      {list.length === 0 ? (
        <EmptyState
          icon="chat"
          title="No conversations yet"
          message={
            role === 'DOCTOR'
              ? 'A conversation opens with a patient once you complete their consultation.'
              : 'A conversation with your doctor opens once your consultation is complete.'
          }
        />
      ) : (
        <View style={styles.list}>
          {list.map((thread) => {
            const name =
              role === 'DOCTOR'
                ? (thread.patient?.fullName ?? 'Patient')
                : (thread.doctor?.name ?? 'Your doctor');
            const preview = thread.lastMessage;
            const mineLast = preview?.senderUserId === user?.id;

            return (
              <Card key={thread.id} onPress={() => open(thread)} style={styles.row}>
                <Avatar name={name} size={44} tint={role === 'DOCTOR' ? 'info' : 'success'} />

                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text
                      variant="labelMd"
                      weight={thread.unreadCount > 0 ? 'bold' : 'semibold'}
                      color={colors.onSurface}
                      numberOfLines={1}
                      style={styles.flex}
                    >
                      {name}
                    </Text>
                    {preview ? (
                      <Text variant="captionSm" color={colors.captionGray}>
                        {relative(preview.createdAt)}
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    variant="captionSm"
                    color={thread.unreadCount > 0 ? colors.onSurface : colors.captionGray}
                    numberOfLines={1}
                  >
                    {preview ? `${mineLast ? 'You: ' : ''}${preview.body}` : 'No messages yet'}
                  </Text>

                  {/* Closed and expired look identical to a patient otherwise. */}
                  {!thread.canSend ? (
                    <View style={styles.stateRow}>
                      <Icon name="lock" size={12} color={colors.captionGray} />
                      <Text variant="captionSm" color={colors.captionGray}>
                        {thread.blockedBecause === 'BLOCKED_BY_ADMIN'
                          ? 'Unavailable'
                          : thread.blockedBecause === 'CLOSED_BY_DOCTOR'
                            ? 'Closed'
                            : 'Ended'}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {thread.unreadCount > 0 ? (
                  <View style={styles.unread}>
                    <Text variant="captionSm" weight="bold" color={colors.onPrimary}>
                      {thread.unreadCount > 9 ? '9+' : String(thread.unreadCount)}
                    </Text>
                  </View>
                ) : (
                  <Icon name="chevron_right" size={20} color={colors.captionGray} />
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  unread: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
