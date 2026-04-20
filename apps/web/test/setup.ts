import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library leaves DOM between tests by default when
// run under vitest; explicit cleanup keeps tests independent.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
