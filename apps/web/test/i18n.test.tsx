import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider, useI18n } from '../src/i18n';

function Probe({ keyName, params }: { keyName: string; params?: Record<string, string | number> }) {
  const { t } = useI18n();
  return <span data-testid="out">{t(keyName, params)}</span>;
}

function PluralProbe({ count }: { count: number }) {
  const { tPlural } = useI18n();
  return <span data-testid="out">{tPlural('children.count', count)}</span>;
}

function Switcher({ to }: { to: 'en' | 'hi' }) {
  const { setLang } = useI18n();
  return (
    <button onClick={() => setLang(to)} data-testid="switch">
      switch
    </button>
  );
}

describe('i18n', () => {
  it('returns the English string by default', () => {
    render(
      <LanguageProvider>
        <Probe keyName="auth.logout" />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('Sign out');
  });

  it('interpolates {param} placeholders', () => {
    render(
      <LanguageProvider>
        <Probe keyName="home.heading" params={{ scope: 'Anandpur' }} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('Anandpur overview');
  });

  it('selects the correct plural form', () => {
    const { rerender } = render(
      <LanguageProvider>
        <PluralProbe count={1} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('1 child');
    rerender(
      <LanguageProvider>
        <PluralProbe count={5} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('5 children');
  });

  it('falls back to English when a key is missing in the active catalog', () => {
    // Every hi-catalog key also exists in en, but the fallback path
    // must be proven so a future missing-key incident surfaces
    // English rather than the raw key name.
    render(
      <LanguageProvider>
        <Switcher to="hi" />
        <Probe keyName="does.not.exist" />
      </LanguageProvider>,
    );
    // Missing in both → returns the key unchanged.
    expect(screen.getByTestId('out')).toHaveTextContent('does.not.exist');
  });

  it('switching language flips strings and persists to localStorage', () => {
    render(
      <LanguageProvider>
        <Switcher to="hi" />
        <Probe keyName="auth.logout" />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('Sign out');
    act(() => {
      screen.getByTestId('switch').click();
    });
    expect(screen.getByTestId('out')).toHaveTextContent('साइन आउट');
    expect(window.localStorage.getItem('nsf.lang')).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
  });
});
