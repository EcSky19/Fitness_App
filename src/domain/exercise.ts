/**
 * MET activity catalogue + calorie burn math.
 *
 * MET values follow the Compendium of Physical Activities. Pure TypeScript:
 * no React Native, no Expo, no I/O.
 */
import type { ExerciseCategory } from '@/types';
import { toFiniteNumber } from './units';

export interface MetActivity {
  id: string;
  name: string;
  category: ExerciseCategory;
  met: number;
}

/** Alias kept for call sites that reference the constant-style name. */
export type MET_ACTIVITY = MetActivity;

export const MET_ACTIVITIES: MetActivity[] = [
  // ---- cardio ----
  { id: 'walking_slow', name: 'Walking (2 mph, slow)', category: 'cardio', met: 2.8 },
  { id: 'walking', name: 'Walking (3 mph, moderate)', category: 'cardio', met: 3.5 },
  { id: 'walking_brisk', name: 'Walking (4 mph, brisk)', category: 'cardio', met: 5.0 },
  { id: 'walking_dog', name: 'Walking the dog', category: 'cardio', met: 3.0 },
  { id: 'jogging', name: 'Jogging (general)', category: 'cardio', met: 7.0 },
  { id: 'running_5mph', name: 'Running (5 mph, 12 min/mile)', category: 'cardio', met: 8.3 },
  { id: 'running_6mph', name: 'Running (6 mph, 10 min/mile)', category: 'cardio', met: 9.8 },
  { id: 'running_7mph', name: 'Running (7 mph, 8.5 min/mile)', category: 'cardio', met: 11.0 },
  { id: 'treadmill_incline', name: 'Treadmill walking (incline)', category: 'cardio', met: 6.0 },
  { id: 'cycling_light', name: 'Cycling (10-12 mph, light)', category: 'cardio', met: 6.0 },
  { id: 'cycling_moderate', name: 'Cycling (12-14 mph, moderate)', category: 'cardio', met: 8.0 },
  { id: 'cycling_vigorous', name: 'Cycling (14-16 mph, vigorous)', category: 'cardio', met: 10.0 },
  { id: 'stationary_bike', name: 'Stationary bike (moderate)', category: 'cardio', met: 7.0 },
  { id: 'spinning', name: 'Spin class', category: 'cardio', met: 8.5 },
  { id: 'swimming', name: 'Swimming (freestyle, moderate)', category: 'cardio', met: 7.0 },
  { id: 'swimming_vigorous', name: 'Swimming (freestyle, vigorous)', category: 'cardio', met: 9.8 },
  { id: 'elliptical', name: 'Elliptical trainer', category: 'cardio', met: 5.0 },
  { id: 'rowing_machine', name: 'Rowing machine (moderate)', category: 'cardio', met: 7.0 },
  { id: 'stair_climber', name: 'Stair climber', category: 'cardio', met: 9.0 },
  { id: 'jump_rope', name: 'Jump rope', category: 'cardio', met: 12.3 },
  { id: 'hiit', name: 'HIIT / circuit training', category: 'cardio', met: 8.0 },
  { id: 'hiking', name: 'Hiking (cross-country)', category: 'cardio', met: 6.0 },
  { id: 'aerobics', name: 'Aerobics class', category: 'cardio', met: 6.5 },
  { id: 'inline_skating', name: 'Inline skating', category: 'cardio', met: 7.5 },
  { id: 'rowing_water', name: 'Rowing (on water)', category: 'cardio', met: 7.0 },

  // ---- strength ----
  { id: 'weight_training', name: 'Weight training (general)', category: 'strength', met: 5.0 },
  { id: 'weight_training_light', name: 'Weight training (light)', category: 'strength', met: 3.5 },
  {
    id: 'weight_training_vigorous',
    name: 'Weight training (vigorous)',
    category: 'strength',
    met: 6.0,
  },
  { id: 'powerlifting', name: 'Powerlifting', category: 'strength', met: 6.0 },
  { id: 'bodyweight_circuit', name: 'Bodyweight circuit', category: 'strength', met: 8.0 },
  { id: 'kettlebell', name: 'Kettlebell training', category: 'strength', met: 9.8 },
  { id: 'crossfit', name: 'CrossFit / functional fitness', category: 'strength', met: 8.0 },
  { id: 'resistance_bands', name: 'Resistance band training', category: 'strength', met: 3.5 },
  { id: 'core_training', name: 'Core / abs training', category: 'strength', met: 4.0 },

  // ---- sports ----
  { id: 'basketball', name: 'Basketball (game)', category: 'sports', met: 6.5 },
  { id: 'soccer', name: 'Soccer (casual)', category: 'sports', met: 7.0 },
  { id: 'tennis', name: 'Tennis (general)', category: 'sports', met: 7.3 },
  { id: 'badminton', name: 'Badminton (social)', category: 'sports', met: 5.5 },
  { id: 'volleyball', name: 'Volleyball (casual)', category: 'sports', met: 4.0 },
  { id: 'baseball', name: 'Baseball / softball', category: 'sports', met: 5.0 },
  { id: 'golf', name: 'Golf (walking, carrying clubs)', category: 'sports', met: 4.8 },
  { id: 'boxing', name: 'Boxing (bag work)', category: 'sports', met: 7.8 },
  { id: 'martial_arts', name: 'Martial arts (moderate)', category: 'sports', met: 10.3 },
  { id: 'rock_climbing', name: 'Rock climbing', category: 'sports', met: 8.0 },
  { id: 'skiing_downhill', name: 'Downhill skiing (moderate)', category: 'sports', met: 5.3 },
  { id: 'snowboarding', name: 'Snowboarding', category: 'sports', met: 5.3 },
  { id: 'surfing', name: 'Surfing', category: 'sports', met: 3.0 },
  { id: 'dancing', name: 'Dancing (general)', category: 'sports', met: 5.0 },
  { id: 'ultimate_frisbee', name: 'Ultimate frisbee', category: 'sports', met: 8.0 },

  // ---- flexibility ----
  { id: 'yoga', name: 'Yoga (hatha)', category: 'flexibility', met: 2.5 },
  { id: 'yoga_power', name: 'Power yoga', category: 'flexibility', met: 4.0 },
  { id: 'pilates', name: 'Pilates', category: 'flexibility', met: 3.0 },
  { id: 'stretching', name: 'Stretching / mobility', category: 'flexibility', met: 2.3 },
  { id: 'tai_chi', name: 'Tai chi', category: 'flexibility', met: 3.0 },
  { id: 'foam_rolling', name: 'Foam rolling', category: 'flexibility', met: 2.0 },

  // ---- other ----
  { id: 'housework', name: 'Housework (general)', category: 'other', met: 3.3 },
  { id: 'gardening', name: 'Gardening', category: 'other', met: 3.8 },
  { id: 'playing_with_kids', name: 'Playing with kids (moderate)', category: 'other', met: 4.0 },
  { id: 'manual_labor', name: 'Manual labor (general)', category: 'other', met: 4.5 },
];

/**
 * `MET * 3.5 * kg / 200 * minutes` — e.g. MET 8, 70 kg, 30 min -> 294 kcal.
 * Rounded to a whole kcal; negative or unusable input yields `0`.
 */
export function calcCaloriesBurned(met: number, weightKg: number, durationMin: number): number {
  const metValue = Math.max(0, toFiniteNumber(met));
  const kg = Math.max(0, toFiniteNumber(weightKg));
  const minutes = Math.max(0, toFiniteNumber(durationMin));
  return Math.round(((metValue * 3.5 * kg) / 200) * minutes);
}

/** Exact (case-insensitive) id lookup. */
export function findActivity(id: string): MET_ACTIVITY | undefined {
  if (typeof id !== 'string') return undefined;
  const needle = id.trim().toLowerCase();
  if (!needle) return undefined;
  return MET_ACTIVITIES.find((activity) => activity.id.toLowerCase() === needle);
}

/**
 * Substring search over name / id / category.
 * An empty query returns the whole catalogue; name-prefix matches rank first.
 */
export function searchActivities(q: string): MET_ACTIVITY[] {
  const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (!needle) return [...MET_ACTIVITIES];

  const matches = MET_ACTIVITIES.filter(
    (activity) =>
      activity.name.toLowerCase().includes(needle) ||
      activity.id.toLowerCase().includes(needle) ||
      activity.category.toLowerCase() === needle,
  );

  return matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.localeCompare(b.name);
  });
}
