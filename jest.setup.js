/* eslint-env jest */
/**
 * Global Jest setup for MacroTrack.
 * Native modules are mocked here so unit tests can run in plain Node.
 * Individual tests may override any of these with jest.mock(...).
 */

// --- react-native-gesture-handler --------------------------------------------
// Ships its own Jest mocks; without them `GestureHandlerRootView` (used by the
// root layout) throws `RNGestureHandlerModule.install is not a function`.
require('react-native-gesture-handler/jestSetup');

// --- react-native-reanimated -------------------------------------------------
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

// --- expo-haptics ------------------------------------------------------------
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// --- expo-sqlite -------------------------------------------------------------
/**
 * Minimal in-memory stub. Tests that need real SQL behaviour should inject their
 * own database with `setTestDb()` / `__setDbFactory()` from `@/db/client`.
 */
jest.mock('expo-sqlite', () => {
  const makeDb = () => ({
    execAsync: jest.fn(async () => {}),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0, changes: 0 })),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (cb) => {
      await cb();
    }),
    closeAsync: jest.fn(async () => {}),
    deleteAsync: jest.fn(async () => {}),
  });
  return {
    openDatabaseAsync: jest.fn(async () => makeDb()),
    openDatabaseSync: jest.fn(() => makeDb()),
    deleteDatabaseAsync: jest.fn(async () => {}),
    SQLiteProvider: ({ children }) => children,
  };
});

// --- expo-camera -------------------------------------------------------------
jest.mock('expo-camera', () => {
  const React = require('react');
  const CameraView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: jest.fn(async () => ({
        uri: 'file:///mock/photo.jpg',
        width: 1024,
        height: 1024,
        base64: undefined,
      })),
    }));
    return React.createElement('CameraView', props, props.children);
  });
  CameraView.displayName = 'CameraView';
  return {
    CameraView,
    CameraType: { back: 'back', front: 'front' },
    useCameraPermissions: jest.fn(() => [
      { granted: true, canAskAgain: true, status: 'granted' },
      jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
    ]),
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
      getCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    },
  };
});

// --- expo-image-picker -------------------------------------------------------
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: true,
    assets: null,
  })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  useMediaLibraryPermissions: jest.fn(() => [
    { granted: true, canAskAgain: true, status: 'granted' },
    jest.fn(async () => ({ granted: true, status: 'granted' })),
  ]),
  MediaTypeOptions: { Images: 'Images', All: 'All' },
  MediaType: { Images: 'images' },
}));

// --- @react-native-async-storage/async-storage -------------------------------
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
      setItem: jest.fn(async (k, v) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k) => {
        store.delete(k);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
      multiGet: jest.fn(async (keys) => keys.map((k) => [k, store.get(k) ?? null])),
      multiSet: jest.fn(async (pairs) => {
        pairs.forEach(([k, v]) => store.set(k, v));
      }),
      multiRemove: jest.fn(async (keys) => {
        keys.forEach((k) => store.delete(k));
      }),
    },
  };
});

// Silence noisy animation warnings in tests.
jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('useNativeDriver') || first.includes('Reanimated')) return;
  // eslint-disable-next-line no-console
  console.info(...args);
});
