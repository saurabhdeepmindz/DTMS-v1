import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage instance for storing request context information
 */
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Get the current context from the async local storage
 */
function getContext() {
  return asyncLocalStorage.getStore() || {};
}

/**
 * Get a value from the current context
 */
function getContextValue(key) {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return undefined;
  }
  return store[key];
}

/**
 * Run a function with a new context
 */
async function runWithContext(fn, initialContext = {}) {
  return await asyncLocalStorage.run(initialContext, fn);
}

/**
 * Add additional context to the logContext in the current store
 * This will merge the provided context with any existing logContext
 */
function addLogContext(additionalContext) {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return;
  }

  const currentLogContext = store.logContext || {};
  store.logContext = {
    ...currentLogContext,
    ...additionalContext,
  };
}

/**
 * Add a log entry to the context for development debugging
 * This is only used in non-production environments
 */
function addLogEntry(data) {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return;
  }

  if (!store.logEntries) {
    store.logEntries = [];
  }

  store.logEntries.push(data);
}

/**
 * Get all log entries from the current context
 */
function getLogEntries() {
  const store = asyncLocalStorage.getStore();
  if (!store || !store.logEntries) {
    return [];
  }

  return [...store.logEntries];
}

export {
  asyncLocalStorage,
  getContext,
  getContextValue,
  runWithContext,
  addLogContext,
  addLogEntry,
  getLogEntries
}; 