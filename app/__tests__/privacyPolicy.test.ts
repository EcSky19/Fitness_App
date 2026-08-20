/**
 * Release gate for the privacy policy.
 *
 * Apple and Google both reject a privacy policy that still contains authoring
 * placeholders, and the in-app screen is what a reviewer actually taps through.
 * These placeholders are easy to forget because nothing else in the build
 * complains about them, so this suite fails loudly instead.
 *
 * If this test fails, the fix is to fill in the real values -- not to relax the
 * assertion.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

/** Matches the `TODO:` authoring markers left for a human to replace. */
const PLACEHOLDER = /TODO:/;

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Collects offending lines so the failure message names them directly. */
function placeholderLines(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => PLACEHOLDER.test(entry.line))
    .map((entry) => `  line ${entry.number}: ${entry.line}`);
}

describe('privacy policy is submission-ready', () => {
  it.each(['PRIVACY.md', join('app', 'privacy.tsx')])(
    '%s has no unfilled placeholders',
    (relativePath) => {
      const offenders = placeholderLines(read(relativePath));

      expect(
        offenders.length === 0
          ? ''
          : `${relativePath} still contains authoring placeholders:\n${offenders.join('\n')}`
      ).toBe('');
    }
  );

  it('the in-app screen names a responsible entity and a contact route', () => {
    const source = read(join('app', 'privacy.tsx'));

    // The screen renders these constants verbatim, so an empty string would ship
    // a blank line to a reviewer rather than an obvious mistake.
    for (const constant of ['LAST_UPDATED', 'RESPONSIBLE_ENTITY', 'CONTACT']) {
      const match = new RegExp(`const ${constant} = '([^']*)'`).exec(source);
      expect(match).not.toBeNull();
      expect(match?.[1]?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
