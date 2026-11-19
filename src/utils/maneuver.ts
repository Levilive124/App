import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const map: Record<string, IconName> = {
  DEPART: 'navigation-variant',
  STRAIGHT: 'arrow-up',
  TURN_LEFT: 'arrow-left-top',
  TURN_RIGHT: 'arrow-right-top',
  TURN_SLIGHT_LEFT: 'arrow-top-left',
  TURN_SLIGHT_RIGHT: 'arrow-top-right',
  TURN_SHARP_LEFT: 'arrow-bottom-left',
  TURN_SHARP_RIGHT: 'arrow-bottom-right',
  UTURN_LEFT: 'arrow-u-left-top',
  UTURN_RIGHT: 'arrow-u-right-top',
  RAMP_LEFT: 'arrow-top-left',
  RAMP_RIGHT: 'arrow-top-right',
  FORK_LEFT: 'call-split',
  FORK_RIGHT: 'call-split',
  MERGE: 'call-merge',
  ROUNDABOUT_LEFT: 'rotate-left',
  ROUNDABOUT_RIGHT: 'rotate-right',
  NAME_CHANGE: 'arrow-up',
  FERRY: 'ferry',
  FERRY_TRAIN: 'train-car',
};

export function maneuverIcon(m?: string): IconName {
  return (m && map[m]) || 'arrow-up';
}

export const modeIcon: Record<string, IconName> = {
  DRIVE: 'car',
  WALK: 'walk',
  BICYCLE: 'bike',
  TRANSIT: 'train',
  TWO_WHEELER: 'motorbike',
};

export const modeLabel: Record<string, string> = {
  DRIVE: 'Auto',
  WALK: 'Zu Fuß',
  BICYCLE: 'Fahrrad',
  TRANSIT: 'ÖPNV',
  TWO_WHEELER: 'Motorrad',
};
