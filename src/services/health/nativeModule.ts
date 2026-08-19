/**
 * Optional native health module loader.
 *
 * `react-native-health` (iOS) and `react-native-health-connect` (Android) are
 * **not** dependencies of this project: MacroTrack ships with the simulated
 * provider and lights up the real one automatically once a developer adds the
 * library to a custom dev build.
 *
 * To keep that possible without breaking Metro or Jest when the package is
 * absent, the module is never imported statically. Resolution order:
 *
 *   1. a module registered at runtime via `registerNativeHealthModule()`
 *      (the supported hook for dev builds — see the README section below),
 *   2. an indirect `require()` held in a variable so bundlers cannot statically
 *      resolve — and therefore cannot fail on — the missing package,
 *   3. the bridged native module (`NativeModules.AppleHealthKit` /
 *      `NativeModules.HealthConnect`) when the JS wrapper is installed.
 *
 * Every step is wrapped in try/catch and validated with narrow runtime feature
 * checks; the module stays typed as `unknown` so nothing here can leak `any`
 * into the rest of the app.
 *
 * Enabling the real integration (nothing in this file changes):
 *   npx expo install react-native-health          # iOS
 *   npx expo install react-native-health-connect  # Android
 *   npx expo prebuild && npx expo run:ios | run:android
 *   // then, once, in app/_layout.tsx:
 *   import AppleHealthKit from 'react-native-health';
 *   registerNativeHealthModule(AppleHealthKit);
 */
import { NativeModules, Platform } from 'react-native';

export const HEALTHKIT_PACKAGE = 'react-native-health';
export const HEALTH_CONNECT_PACKAGE = 'react-native-health-connect';

/** Native module names as registered by the two libraries. */
const HEALTHKIT_NATIVE_MODULE = 'AppleHealthKit';
const HEALTH_CONNECT_NATIVE_MODULE = 'HealthConnect';

/** Any one of these proves we are looking at the HealthKit JS/native module. */
const HEALTHKIT_SIGNATURE = ['initHealthKit', 'isAvailable', 'getStepCount'] as const;
/** Any one of these proves we are looking at the Health Connect module. */
const HEALTH_CONNECT_SIGNATURE = ['initialize', 'readRecords', 'requestPermission'] as const;

type RequireLike = (moduleId: string) => unknown;

let registeredModule: unknown = null;
let cachedModule: unknown = null;
let cacheKey: string | null = null;

// ---------------------------------------------------------------------------
// Narrow runtime helpers (used by the HealthKit / Health Connect providers)
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Returns the named method bound-able off `target`, or `null`. */
export function getMethod(
  target: unknown,
  name: string
): ((...args: unknown[]) => unknown) | null {
  if (!isRecord(target) && typeof target !== 'function') return null;
  const candidate = (target as Record<string, unknown>)[name];
  return typeof candidate === 'function' ? (candidate as (...args: unknown[]) => unknown) : null;
}

export function hasMethod(target: unknown, name: string): boolean {
  return getMethod(target, name) !== null;
}

export function hasAnyMethod(target: unknown, names: readonly string[]): boolean {
  return names.some((name) => hasMethod(target, name));
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof (value as { then?: unknown }).then === 'function';
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Hook for dev builds: hand the imported library to the health module once at
 * startup. Passing `null` clears it again.
 */
export function registerNativeHealthModule(module: unknown): void {
  registeredModule = module ?? null;
  resetNativeHealthModule();
}

/** Test hook: forgets the memoised lookup (the registered module is kept). */
export function resetNativeHealthModule(): void {
  cachedModule = null;
  cacheKey = null;
}

/**
 * Returns a `require`-like function when one exists in this runtime.
 *
 * The reference is held in a variable so bundlers treat the later `req(id)`
 * call as an ordinary function call instead of a static dependency.
 */
function resolveRequire(): RequireLike | null {
  try {
    const scoped: unknown = typeof require === 'function' ? require : undefined;
    if (typeof scoped === 'function') return scoped as RequireLike;
  } catch {
    // Some runtimes throw on touching `require`; fall through.
  }
  try {
    const globalRequire = (globalThis as { require?: unknown }).require;
    if (typeof globalRequire === 'function') return globalRequire as RequireLike;
  } catch {
    // Ignore — no dynamic require available.
  }
  return null;
}

/** `require(moduleId)` that returns `null` instead of throwing when absent. */
function optionalRequire(moduleId: string): unknown {
  const req = resolveRequire();
  if (!req) return null;
  try {
    const loaded = req(moduleId);
    if (!loaded) return null;
    if (isRecord(loaded)) {
      const withDefault = loaded as { default?: unknown };
      if (withDefault.default) return withDefault.default;
    }
    return loaded;
  } catch {
    return null;
  }
}

/** Reads a module off the RN bridge without throwing when it is not linked. */
function bridgedModule(name: string): unknown {
  try {
    const modules = NativeModules as unknown as Record<string, unknown> | undefined;
    return modules?.[name] ?? null;
  } catch {
    return null;
  }
}

function loadFor(os: string): unknown {
  const isAndroid = os === 'android';
  const packageName = isAndroid ? HEALTH_CONNECT_PACKAGE : HEALTHKIT_PACKAGE;
  const nativeName = isAndroid ? HEALTH_CONNECT_NATIVE_MODULE : HEALTHKIT_NATIVE_MODULE;
  const signature = isAndroid ? HEALTH_CONNECT_SIGNATURE : HEALTHKIT_SIGNATURE;

  if (registeredModule && hasAnyMethod(registeredModule, signature)) return registeredModule;

  const required = optionalRequire(packageName);
  if (required && hasAnyMethod(required, signature)) return required;

  const bridged = bridgedModule(nativeName);
  if (bridged && hasAnyMethod(bridged, signature)) return bridged;

  return null;
}

/**
 * The platform health module, or `null` when it is not installed/linked.
 * Never throws — callers fall back to the simulated provider.
 *
 * @param os Platform override; defaults to `Platform.OS`.
 */
export function loadNativeHealthModule(os?: string): unknown | null {
  let platformOS = os;
  if (platformOS === undefined) {
    try {
      platformOS = Platform.OS;
    } catch {
      platformOS = 'unknown';
    }
  }

  if (platformOS !== 'ios' && platformOS !== 'android') return null;
  if (cacheKey === platformOS && cachedModule) return cachedModule;

  let resolved: unknown = null;
  try {
    resolved = loadFor(platformOS);
  } catch {
    resolved = null;
  }

  cacheKey = platformOS;
  cachedModule = resolved;
  return resolved;
}

/** True when the platform library is present and usable right now. */
export function isNativeHealthModuleAvailable(os?: string): boolean {
  return loadNativeHealthModule(os) !== null;
}

/** Package a developer must add to a dev build to enable real data on `os`. */
export function nativeHealthPackageFor(os: string): string | null {
  if (os === 'ios') return HEALTHKIT_PACKAGE;
  if (os === 'android') return HEALTH_CONNECT_PACKAGE;
  return null;
}
