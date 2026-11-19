/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TokenDetails from './TokenDetails';
import { type TokenBreakdown } from './useTokenBreakdown';

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { config: { isDevMode: boolean } }) => unknown) =>
    selector({ config: { isDevMode: false } }),
}));

const createBreakdown = (overrides: Partial<TokenBreakdown> = {}): TokenBreakdown => ({
  chatsToken: 100,
  fileContextToken: 20,
  lastRequestInputTokens: 8_000,
  maxTokens: 10_000,
  reasoningToken: 30,
  systemToken: 40,
  toolCallsToken: 50,
  toolsToken: 60,
  totalToken: 300,
  usedToken: 3_000,
  ...overrides,
});

const getDisplayedValue = (title: string) => {
  const label = screen.getByText(title);
  const row = label.parentElement;

  return row?.nextElementSibling?.textContent;
};

describe('TokenDetails', () => {
  it('renders used and remaining values from the full token breakdown', () => {
    const breakdown = createBreakdown();

    expect(() => render(<TokenDetails breakdown={breakdown} />)).not.toThrow();

    expect(getDisplayedValue('tokenDetails.used')).toBe('3K');
    expect(getDisplayedValue('tokenDetails.rest')).toBe('7K');
  });

  it('clamps remaining tokens to zero when usage exceeds the context window', () => {
    render(<TokenDetails breakdown={createBreakdown({ totalToken: 12_000, usedToken: 12_000 })} />);

    expect(getDisplayedValue('tokenDetails.used')).toBe('12K');
    expect(getDisplayedValue('tokenDetails.rest')).toBe('0');
  });
});
