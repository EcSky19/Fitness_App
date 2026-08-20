/**
 * MacroTrack calculation engine — the single import surface for all pure
 * domain math (`import { calcBMR, todayISO } from '@/domain'`).
 *
 * Every module here is plain TypeScript: **no React Native / Expo imports**, no
 * I/O, no globals beyond `Date`. That keeps the engine testable in bare Node and
 * safe to call from stores, repositories and screens alike.
 */
export * from './dates';
export * from './units';
export * from './nutrition';
export * from './goals';
export * from './weight';
export * from './exercise';
export * from './recipes';
