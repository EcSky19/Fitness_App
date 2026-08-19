import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, Divider, ListRow, SectionHeader, useTheme } from '@/ui';
import { calcAge, formatHeight, formatWeight } from '@/domain';
import type { HeightUnit, UserProfile, WeightUnit } from '@/types';

import { activityShortLabel } from './ActivityLevelPicker';
import { PROFILE_FIELD_TITLES, type ProfileField } from './ProfileFieldSheet';

const ROWS: { field: ProfileField; icon: keyof typeof Ionicons.glyphMap }[] = [
  { field: 'name', icon: 'person-outline' },
  { field: 'sex', icon: 'male-female-outline' },
  { field: 'birthDate', icon: 'calendar-outline' },
  { field: 'height', icon: 'resize-outline' },
  { field: 'weight', icon: 'barbell-outline' },
  { field: 'goalWeight', icon: 'flag-outline' },
  { field: 'activityLevel', icon: 'walk-outline' },
];

export interface BodyStatsCardProps {
  profile: UserProfile;
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  onEdit: (field: ProfileField) => void;
  testID?: string;
}

function valueFor(
  field: ProfileField,
  profile: UserProfile,
  weightUnit: WeightUnit,
  heightUnit: HeightUnit
): string {
  switch (field) {
    case 'name':
      return profile.name || 'Not set';
    case 'sex':
      return profile.sex === 'male' ? 'Male' : 'Female';
    case 'birthDate': {
      const age = calcAge(profile.birthDate);
      return Number.isFinite(age) && age > 0 ? `${age} yrs` : 'Not set';
    }
    case 'height':
      return profile.heightCm > 0 ? formatHeight(profile.heightCm, heightUnit) : 'Not set';
    case 'weight':
      return profile.currentWeightKg > 0 ? formatWeight(profile.currentWeightKg, weightUnit) : 'Not set';
    case 'goalWeight':
      return profile.goalWeightKg && profile.goalWeightKg > 0
        ? formatWeight(profile.goalWeightKg, weightUnit)
        : 'Not set';
    case 'activityLevel':
      return activityShortLabel(profile.activityLevel);
  }
}

/** Editable body stats. Every row opens `ProfileFieldSheet` for that field. */
export function BodyStatsCard({
  profile,
  weightUnit,
  heightUnit,
  onEdit,
  testID = 'body-stats-card',
}: BodyStatsCardProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View testID={testID}>
      <SectionHeader title="Body stats" />
      <Card padded={false}>
        {ROWS.map((row, index) => (
          <View key={row.field}>
            {index > 0 ? <Divider /> : null}
            <ListRow
              title={PROFILE_FIELD_TITLES[row.field]}
              meta={valueFor(row.field, profile, weightUnit, heightUnit)}
              leftIcon={row.icon}
              leftColor={colors.primary}
              onPress={() => onEdit(row.field)}
              testID={`body-stat-${row.field}`}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
