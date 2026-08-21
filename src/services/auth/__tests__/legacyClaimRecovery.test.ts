/**
 * Legacy-claim recovery + privacy guard.
 *
 * These tests isolate the ORCHESTRATION in `@/services/auth` — when is
 * `claimLegacyData()` allowed to run — by faking `@/db/repositories/accounts`
 * with a stateful store that can FAIL the claim on demand. The real crypto and
 * secure-store shims are reused so password hashing/verification is production
 * code.
 *
 * The bug under test: a claim that throws during the first sign-up used to
 * return `storage_error` even though the account row was already committed, so
 * the pre-auth diary stayed `account_id IS NULL` forever and no later sign-in
 * ever retried the claim — permanent, silent loss of the user's whole history.
 */
jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());
jest.mock('expo-secure-store', () =>
  require('@/services/auth/__tests__/nativeMocks').secureStoreMock()
);

import {
  __resetAuthState,
  getCurrentSession,
  signIn,
  signOut,
  signUp,
} from '@/services/auth';
import { __resetSessionStorage } from '@/services/auth/sessionStorage';
import type { SecureStoreMock } from '@/services/auth/__tests__/nativeMocks';
import type { Account, AccountRecord, PasswordHashFields } from '@/types';

// --- Stateful fake of @/db/repositories/accounts ---------------------------
// Models a single-user device whose migration-era diary is still unclaimed.
// Crucially, `claimLegacyData` does NOT itself decide *when* it is safe to run;
// the auth service does. That decision is exactly what is under test.

type MockNewAccount = {
  email: string;
  displayName: string;
  password: PasswordHashFields;
  securityQuestion?: string | null;
  securityAnswer?: PasswordHashFields | null;
};

const mockDb = { byId: new Map<string, AccountRecord>(), seq: 0 };
const mockLegacy = { orphanRows: 0, owner: null as string | null, throwOnce: false };

function mockNormalize(email: string): string {
  return email.trim().toLowerCase();
}

const mockGetAccountByEmail = jest.fn(async (email: string): Promise<AccountRecord | null> => {
  const wanted = mockNormalize(email);
  for (const record of mockDb.byId.values()) {
    if (record.email === wanted) return record;
  }
  return null;
});

const mockGetAccountById = jest.fn(
  async (id: string): Promise<AccountRecord | null> => mockDb.byId.get(id) ?? null
);

const mockCountAccounts = jest.fn(async (): Promise<number> => mockDb.byId.size);

const mockCreateAccount = jest.fn(async (input: MockNewAccount): Promise<Account> => {
  const email = mockNormalize(input.email);
  mockDb.seq += 1;
  const id = `acct-${mockDb.seq}`;
  const now = '2026-01-01T00:00:00.000Z';
  const record: AccountRecord = {
    id,
    email,
    displayName: input.displayName,
    securityQuestion: input.securityQuestion ?? null,
    hasSecurityAnswer: Boolean(input.securityAnswer),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    password: input.password,
    securityAnswer: input.securityAnswer ?? null,
  };
  mockDb.byId.set(id, record);
  // PUBLIC shape only — mirrors the real createAccount return (no credentials).
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    securityQuestion: record.securityQuestion,
    hasSecurityAnswer: record.hasSecurityAnswer,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  };
});

const mockClaimLegacyData = jest.fn(async (accountId: string): Promise<number> => {
  if (mockLegacy.throwOnce) {
    mockLegacy.throwOnce = false;
    throw new Error('claimLegacyData: cannot start a transaction within a transaction');
  }
  if (mockLegacy.orphanRows > 0 && mockLegacy.owner === null) {
    mockLegacy.owner = accountId;
    const claimed = mockLegacy.orphanRows;
    mockLegacy.orphanRows = 0;
    return claimed;
  }
  return 0;
});

const mockTouchLastLogin = jest.fn(async (id: string): Promise<void> => {
  const record = mockDb.byId.get(id);
  if (record) record.lastLoginAt = '2026-01-02T00:00:00.000Z';
});

const mockUpdateAccountPassword = jest.fn(
  async (_id: string, _password: PasswordHashFields): Promise<void> => undefined
);

jest.mock('@/db/repositories/accounts', () => ({
  __esModule: true,
  AccountEmailTakenError: class AccountEmailTakenError extends Error {
    readonly code = 'email_taken';
  },
  getAccountByEmail: (email: string) => mockGetAccountByEmail(email),
  getAccountById: (id: string) => mockGetAccountById(id),
  countAccounts: () => mockCountAccounts(),
  createAccount: (input: MockNewAccount) => mockCreateAccount(input),
  claimLegacyData: (accountId: string) => mockClaimLegacyData(accountId),
  touchLastLogin: (id: string) => mockTouchLastLogin(id),
  updateAccountPassword: (id: string, password: PasswordHashFields) =>
    mockUpdateAccountPassword(id, password),
  deleteAccount: jest.fn(async () => undefined),
  listAccounts: jest.fn(async () => []),
  updateAccount: jest.fn(async () => undefined),
  updateAccountSecurityQuestion: jest.fn(async () => undefined),
}));

const secureStore = jest.requireMock('expo-secure-store') as SecureStoreMock;

const ADA = { email: 'ada@example.com', password: 'a very good password', displayName: 'Ada' };
const GRACE = { email: 'grace@example.com', password: 'another good password', displayName: 'Grace' };

beforeEach(() => {
  mockDb.byId.clear();
  mockDb.seq = 0;
  mockLegacy.orphanRows = 0;
  mockLegacy.owner = null;
  mockLegacy.throwOnce = false;
  __resetAuthState();
  __resetSessionStorage();
  secureStore.__store.clear();
  secureStore.__fail.read = false;
  secureStore.__fail.write = false;
});

describe('auth service — legacy-claim recovery', () => {
  it('still signs the user in when the claim throws during sign-up', async () => {
    mockLegacy.orphanRows = 3;
    mockLegacy.throwOnce = true; // the claim fails on this first attempt

    const result = await signUp(ADA);

    // The account row is committed, so the user must NOT be stranded on a
    // storage_error that a retry would turn into email_taken.
    expect(result.ok).toBe(true);
    expect(result.data?.email).toBe('ada@example.com');
    expect(getCurrentSession()?.accountId).toBe(result.data?.accountId);
    // The diary is still orphaned for now; recovery happens on the next sign-in.
    expect(mockLegacy.owner).toBeNull();
    expect(mockLegacy.orphanRows).toBe(3);
  });

  it('recovers an orphaned pre-auth diary on a later sign-in while it is the only account', async () => {
    const created = await signUp(ADA);
    expect(created.ok).toBe(true);

    // Simulate a claim that never completed during sign-up: the sole account
    // exists but its pre-auth diary is still unclaimed.
    mockLegacy.orphanRows = 3;
    mockLegacy.owner = null;
    mockClaimLegacyData.mockClear();
    await signOut();

    const signedIn = await signIn({ email: ADA.email, password: ADA.password });

    expect(signedIn.ok).toBe(true);
    expect(mockClaimLegacyData).toHaveBeenCalledTimes(1); // retried on sign-in
    expect(mockLegacy.owner).toBe(created.data?.accountId); // adopted by the sole account
    expect(mockLegacy.orphanRows).toBe(0);
  });

  it('never claims an orphaned diary once a SECOND account exists (privacy guard)', async () => {
    const first = await signUp(ADA);
    const second = await signUp(GRACE);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // A pre-auth diary is still unclaimed and two accounts now exist — ownership
    // is ambiguous, so no sign-in may adopt it.
    mockLegacy.orphanRows = 5;
    mockLegacy.owner = null;
    mockClaimLegacyData.mockClear();
    await signOut();

    const adaSignsIn = await signIn({ email: ADA.email, password: ADA.password });
    const graceSignsIn = await signIn({ email: GRACE.email, password: GRACE.password });

    expect(adaSignsIn.ok).toBe(true);
    expect(graceSignsIn.ok).toBe(true);
    expect(mockClaimLegacyData).not.toHaveBeenCalled();
    expect(mockLegacy.orphanRows).toBe(5);
    expect(mockLegacy.owner).toBeNull();
  });
});
