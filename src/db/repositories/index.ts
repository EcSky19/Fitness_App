/**
 * SQLite repositories (data access layer).
 *
 * Screens and services import everything from here:
 *   import { listEntriesByDate, addFoodEntry } from '@/db/repositories';
 *
 * Every function runs pending migrations first (`ensureReady`), uses
 * parameterized SQL only, and every mutation bumps `dataVersion` on the app
 * store so `useAsyncData` re-queries.
 */

// profile
export { getProfile, saveProfile, PROFILE_ID } from './profile';

// goals
export { getActiveGoal, getGoal, listGoals, saveGoal } from './goals';

// foods
export {
  bumpFoodUsage,
  countFoods,
  deleteFood,
  getFood,
  getFoodByBarcode,
  listFavoriteFoods,
  listRecentFoods,
  searchFoods,
  seedFoods,
  toggleFavoriteFood,
  upsertFood,
  type FoodInput,
} from './foods';

// food entries
export {
  addFoodEntries,
  addFoodEntry,
  deleteFoodEntry,
  getFoodEntry,
  listEntriesByDate,
  listEntriesByDateRange,
  repeatEntries,
  updateFoodEntry,
  type NewFoodEntry,
} from './foodEntries';

// recipes
export {
  createRecipeFromEntries,
  deleteRecipe,
  getRecipe,
  listRecipes,
  logRecipe,
  saveRecipe,
  searchRecipes,
  toggleFavoriteRecipe,
} from './recipes';

// exercise
export {
  addExerciseEntry,
  deleteExerciseEntry,
  getExerciseEntry,
  listExercisesByDate,
  listExercisesByDateRange,
  updateExerciseEntry,
  upsertExternalExercise,
  type NewExerciseEntry,
} from './exercise';

// weight
export {
  addWeightLog,
  deleteWeightLog,
  getLatestWeight,
  getWeightLog,
  getWeightLogByDate,
  listWeightLogs,
  listWeightLogsByRange,
  updateWeightLog,
  type NewWeightLog,
} from './weight';

// settings
export { getSettings, saveSettings, SETTINGS_KEYS } from './settings';

// admin
export { clearAllData, exportAllData, getDbStats, type DbStats } from './admin';
export {
  importAllData,
  type ImportOptions,
  type ImportResult,
  type ImportTableCount,
  type ImportTableName,
} from './importData';

// mappers + row types (useful for services that read rows directly)
export {
  EMPTY_MACROS,
  escapeLikePattern,
  exerciseEntryToRow,
  foodEntryToRow,
  foodToRow,
  goalToRow,
  macrosToColumns,
  profileToRow,
  rowToExerciseEntry,
  rowToFood,
  rowToFoodEntry,
  rowToGoal,
  rowToMacros,
  rowToProfile,
  rowToWeightLog,
  scaleMacros,
  weightLogToRow,
  type ExerciseEntryRow,
  type FoodEntryRow,
  type FoodRow,
  type GoalRow,
  type ProfileRow,
  type SettingsRow,
  type WeightLogRow,
} from './mappers';
