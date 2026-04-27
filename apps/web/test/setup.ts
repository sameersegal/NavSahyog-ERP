import '@testing-library/jest-dom/vitest';
// Polyfill IndexedDB for jsdom (no native impl). Loading the auto
// shim once at setup time installs window.indexedDB / IDBKeyRange /
// IDBFactory globals so lib/idb.ts works in tests without a stub.
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library leaves DOM between tests by default when
// run under vitest; explicit cleanup keeps tests independent.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
