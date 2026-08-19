/**
 * MacroTrack shared type contract.
 *
 * This file is the single source of truth for every data shape in the app.
 * Treat it as FROZEN: other modules (repositories, domain, UI, services) are
 * written against these exact names and fields.
 */

export type ID = string;
export type ISODate = string;      // 'YYYY-MM-DD'
export type ISODateTime = string;  // full ISO 8601

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'cut' | 'maintain' | 'bulk';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type WeightUnit = 'kg' | 'lb';
export type HeightUnit = 'cm' | 'ft_in';
export type ServingUnit = 'g' | 'ml' | 'oz' | 'serving' | 'piece' | 'cup' | 'tbsp' | 'tsp';
export type FoodSource = 'seed' | 'custom' | 'vision' | 'label' | 'quick_add';
export type EntrySource = 'manual' | 'healthkit' | 'health_connect';
export type ExerciseCategory = 'cardio' | 'strength' | 'sports' | 'flexibility' | 'other';
export type VisionMode = 'food_photo' | 'nutrition_label';
export type MacroSplitPreset = 'balanced' | 'high_protein' | 'low_carb' | 'keto' | 'custom';

export interface Macros {
  calories: number; // kcal
  protein: number;  // g
  carbs: number;    // g
  fat: number;      // g
  fiber?: number;   // g
  sugar?: number;   // g
  sodium?: number;  // mg
}

export interface MacroTargets {
  calories: number; protein: number; carbs: number; fat: number;
}

export interface UserProfile {
  id: ID;
  name: string;
  sex: Sex;
  birthDate: ISODate;
  heightCm: number;
  currentWeightKg: number;
  goalWeightKg: number | null;
  activityLevel: ActivityLevel;
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  onboardedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Goal {
  id: ID;
  type: GoalType;
  /** Positive = gain, negative = loss. 0 for maintain. */
  rateKgPerWeek: number;
  macroSplit: MacroSplitPreset;
  targets: MacroTargets;
  isManualOverride: boolean;
  startedAt: ISODate;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Food {
  id: ID;
  name: string;
  brand: string | null;
  /** Canonical nutrition per 100 g (or per 100 ml for liquids). */
  per100g: Macros;
  /** Grams in one "serving". */
  servingSizeG: number;
  servingLabel: string; // e.g. "1 cup (240 g)"
  barcode: string | null;
  source: FoodSource;
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface FoodEntry {
  id: ID;
  date: ISODate;
  mealType: MealType;
  foodId: ID | null;
  name: string;
  brand: string | null;
  quantity: number;
  unit: ServingUnit;
  servingLabel: string;
  /** Total grams consumed; used to recompute macros from per100g. */
  gramsTotal: number;
  /** ABSOLUTE macros for the amount actually logged. */
  macros: Macros;
  photoUri: string | null;
  source: FoodSource;
  visionConfidence: number | null; // 0..1
  wasEdited: boolean;
  loggedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ExerciseEntry {
  id: ID;
  date: ISODate;
  name: string;
  category: ExerciseCategory;
  durationMin: number;
  caloriesBurned: number;
  source: EntrySource;
  externalId: string | null;
  notes: string | null;
  loggedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WeightLog {
  id: ID;
  date: ISODate;
  weightKg: number;
  bodyFatPct: number | null;
  note: string | null;
  source: EntrySource;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface HealthWorkout {
  externalId: string;
  name: string;
  category: ExerciseCategory;
  startAt: ISODateTime;
  durationMin: number;
  caloriesBurned: number;
}

export interface HealthDaySummary {
  date: ISODate;
  steps: number;
  activeEnergyKcal: number;
  restingEnergyKcal: number;
  exerciseMinutes: number;
  distanceMeters: number;
  workouts: HealthWorkout[];
}

export interface DailySummary {
  date: ISODate;
  consumed: Macros;
  byMeal: Record<MealType, Macros>;
  exerciseBurned: number;
  targets: MacroTargets;
  /** consumed.calories - exerciseBurned */
  netCalories: number;
  /** targets.calories - consumed.calories + exerciseBurned */
  remainingCalories: number;
  entryCount: number;
}

export interface AppSettings {
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  energyUnit: 'kcal' | 'kJ';
  visionProvider: string;    // 'mock' | 'openai' | 'gemini'
  healthSyncEnabled: boolean;
  addExerciseToTarget: boolean;
  theme: 'system' | 'light' | 'dark';
}

// ---- Vision contract ----
export interface VisionFoodItem {
  name: string;
  brand: string | null;
  quantity: number;
  unit: ServingUnit;
  servingLabel: string;
  estimatedGrams: number;
  /** ABSOLUTE macros for estimatedGrams. */
  macros: Macros;
  /** 0..1 */
  confidence: number;
  notes: string | null;
}

export interface VisionResult {
  mode: VisionMode;
  items: VisionFoodItem[];
  provider: string;
  modelId: string;
  latencyMs: number;
  rawText: string | null;
  warnings: string[];
}

export interface VisionInput {
  imageBase64: string;
  mimeType: string; // 'image/jpeg'
  mode: VisionMode;
  hint?: string;
}

export interface VisionProvider {
  readonly id: string;
  readonly modelId: string;
  isConfigured(): boolean;
  analyze(input: VisionInput): Promise<VisionResult>;
}

// ---- Health contract ----
export type HealthPermissionStatus = 'granted' | 'denied' | 'unavailable' | 'undetermined';

export interface HealthService {
  readonly platform: 'healthkit' | 'health_connect' | 'mock';
  isAvailable(): Promise<boolean>;
  getPermissionStatus(): Promise<HealthPermissionStatus>;
  requestPermissions(): Promise<HealthPermissionStatus>;
  getDaySummary(date: ISODate): Promise<HealthDaySummary>;
  getRange(startDate: ISODate, endDate: ISODate): Promise<HealthDaySummary[]>;
  getLatestWeightKg(): Promise<number | null>;
  writeWeight(weightKg: number, date: ISODate): Promise<boolean>;
}

export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
