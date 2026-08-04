import React from 'react';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';
import { colors } from '../theme/colors';

/**
 * The Stitch designs use Material Symbols names (snake_case). `@expo/vector-icons`
 * ships Material Icons (kebab-case) plus MaterialCommunityIcons. This maps the
 * design's vocabulary onto whichever set actually has the glyph, so screens can
 * be written using the exact names from the reference markup.
 */
const COMMUNITY_ONLY: Record<string, string> = {
  stethoscope: 'stethoscope',
  test_tube: 'test-tube',
  ambulance: 'ambulance',
  doctor: 'doctor',
  clipboard_pulse: 'clipboard-pulse',
  hospital_building: 'hospital-building',
};

/** Design name -> Material Icons name, where a plain kebab-case swap is wrong. */
const ALIASES: Record<string, string> = {
  pill: 'medication',
  spa: 'spa',
  emergency: 'emergency',
  biotech: 'biotech',
  videocam: 'videocam',
  verified: 'verified',
  water_drop: 'water-drop',
  medical_services: 'medical-services',
  shopping_cart: 'shopping-cart',
  calendar_month: 'calendar-month',
  child_care: 'child-care',
  arrow_back: 'arrow-back',
  chevron_right: 'chevron-right',
  chevron_left: 'chevron-left',
  expand_more: 'expand-more',
  check_circle: 'check-circle',
  radio_button_unchecked: 'radio-button-unchecked',
  local_pharmacy: 'local-pharmacy',
  local_shipping: 'local-shipping',
  receipt_long: 'receipt-long',
  account_balance_wallet: 'account-balance-wallet',
  credit_card: 'credit-card',
  location_on: 'location-on',
  fmd_good: 'fmd-good',
  support_agent: 'support-agent',
  monitor_heart: 'monitor-heart',
  upload_file: 'upload-file',
  picture_as_pdf: 'picture-as-pdf',
  filter_list: 'filter-list',
  more_vert: 'more-vert',
  call_end: 'call-end',
  mic_off: 'mic-off',
  videocam_off: 'videocam-off',
  trending_up: 'trending-up',
  inventory_2: 'inventory-2',
  fact_check: 'fact-check',
  qr_code: 'qr-code',
  directions_car: 'directions-car',
  bloodtype: 'bloodtype',
  event_available: 'event-available',
  event_busy: 'event-busy',
  person_add: 'person-add',
  admin_panel_settings: 'admin-panel-settings',
  notifications_active: 'notifications-active',
  content_copy: 'content-copy',
  open_in_new: 'open-in-new',
  keyboard_arrow_down: 'keyboard-arrow-down',
  keyboard_arrow_up: 'keyboard-arrow-up',
  remove_circle_outline: 'remove-circle-outline',
  add_circle_outline: 'add-circle-outline',
  shopping_bag: 'shopping-bag',
  medical_information: 'medical-information',
  health_and_safety: 'health-and-safety',
  sticky_note_2: 'sticky-note-2',
  auto_stories: 'auto-stories',
  file_download: 'file-download',
  play_circle: 'play-circle',
  volume_up: 'volume-up',
  flip_camera_ios: 'flip-camera-ios',
  screen_share: 'screen-share',
  chat_bubble: 'chat-bubble',
  attach_file: 'attach-file',
  campaign: 'campaign',
  workspace_premium: 'workspace-premium',
  military_tech: 'military-tech',
  currency_rupee: 'currency-rupee',
  attach_money: 'attach-money',

  /**
   * Material Symbols names with no Material Icons equivalent, mapped to the
   * closest glyph that does exist. Without these they render as an empty box —
   * which nothing but a human looking at the screen would catch.
   */
  prescriptions: 'medication',
  clinical_notes: 'note-alt',
  home_pin: 'person-pin-circle',
  hourglass_top: 'hourglass-top',
  event_repeat: 'event-repeat',
  tips_and_updates: 'tips-and-updates',
  no_food: 'no-food',
  photo_camera: 'photo-camera',
  verified_user: 'verified-user',
  location_city: 'location-city',
  admin_panel: 'admin-panel-settings',
};

export interface IconProps {
  /** A Material Symbols name as used in the Stitch markup, e.g. `water_drop`. */
  name: string;
  size?: number;
  color?: string;
  filled?: boolean;
  style?: StyleProp<TextStyle>;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = colors.onSurfaceVariant,
  style,
}) => {
  const communityName = COMMUNITY_ONLY[name];
  if (communityName) {
    return (
      <MaterialCommunityIcons
        name={communityName as never}
        size={size}
        color={color}
        style={style}
      />
    );
  }

  const materialName = ALIASES[name] ?? name.replace(/_/g, '-');
  return <MaterialIcons name={materialName as never} size={size} color={color} style={style} />;
};
