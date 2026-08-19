# MacroTrack

This project runs **Expo SDK 54** (expo `~54.0.36`, react-native `0.81.4`, react `19.1.0`) with
`expo-router` v6 and TypeScript.

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## Conventions

- Path alias `@/*` -> `./src/*` (configured in `tsconfig.json` and `jest.config.js`).
- Shared types live in `src/types/index.ts` — treat them as a frozen contract.
- Database access goes through `src/db/client.ts` (`getDb`, `initDatabase`) and
  `src/db/repositories/` (repository layer).
- Global app state is `src/store/appStore.ts` (zustand). Call `invalidate()` after any write.
- Verify with `npm run typecheck` and `npm test`.

## Dependency install notes

- `npx expo install <package>` works and picks SDK 54 compatible versions.
- Do **not** run `npx expo install --fix` / `--check`: the configured npm registry mirror does not
  yet carry `expo@54.0.37`, so `--fix` rewrites `package.json` to a version that cannot be
  installed. Pin `expo` at `~54.0.36`.
