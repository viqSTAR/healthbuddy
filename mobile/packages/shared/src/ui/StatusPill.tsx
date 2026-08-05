import React from 'react';
import { Badge } from './Badge';
import type { TintName } from '../theme/colors';

/** Maps every backend status enum onto the design system's tint vocabulary. */
const TONE: Record<string, TintName> = {
  // Appointments
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  // Medicine orders
  PENDING_PAYMENT: 'warning',
  PLACED: 'info',
  ACCEPTED: 'info',
  PROCESSING: 'warning',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  // Lab orders
  BOOKED: 'info',
  SAMPLE_COLLECTED: 'warning',
  // Emergency
  RAISED: 'danger',
  EN_ROUTE: 'warning',
  ARRIVED: 'info',
  RESOLVED: 'success',
  // Payments and settlement
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'warning',
  SETTLED: 'success',
  REVERSED: 'danger',
  // Provider applications
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const label = (status: string) =>
  status
    .split('_')
    .map((w) => w[0]! + w.slice(1).toLowerCase())
    .join(' ');

export const StatusPill: React.FC<{ status: string; icon?: string }> = ({ status, icon }) => (
  <Badge label={label(status)} tint={TONE[status] ?? 'neutral'} icon={icon} />
);
