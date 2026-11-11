import { getContextValue } from '../utils/index.js';
import { compileCode, compileCodeAsync } from './compiler.js';

const codeFunctionCache = new Map();
const asyncCodeFunctionCache = new Map();

function getMaxCacheSize() {
  const advancedOptions = getContextValue('advancedOptions');
  return advancedOptions?.maxCodeCacheSize || 10_000;
}

function createCacheKey(code) {
  return code;
}

function getCachedCode(code) {
  const cacheKey = createCacheKey(code);

  if (codeFunctionCache.has(cacheKey)) {
    return codeFunctionCache.get(cacheKey);
  }

  const fn = compileCode(code);

  // Simple LRU: remove oldest entry when cache is full
  const maxCacheSize = getMaxCacheSize();
  if (codeFunctionCache.size >= maxCacheSize) {
    const firstKey = codeFunctionCache.keys().next().value;
    codeFunctionCache.delete(firstKey);
  }

  codeFunctionCache.set(cacheKey, fn);
  return fn;
}

function getCachedCodeAsync(code) {
  const cacheKey = createCacheKey(code);

  if (asyncCodeFunctionCache.has(cacheKey)) {
    return asyncCodeFunctionCache.get(cacheKey);
  }

  const fn = compileCodeAsync(code);

  // Simple LRU: remove oldest entry when cache is full
  const maxCacheSize = getMaxCacheSize();
  if (asyncCodeFunctionCache.size >= maxCacheSize) {
    const firstKey = asyncCodeFunctionCache.keys().next().value;
    asyncCodeFunctionCache.delete(firstKey);
  }

  asyncCodeFunctionCache.set(cacheKey, fn);
  return fn;
}

function clearCodeCache() {
  codeFunctionCache.clear();
  asyncCodeFunctionCache.clear();
}

function getCodeCacheSize() {
  return codeFunctionCache.size + asyncCodeFunctionCache.size;
}

export {
  createCacheKey,
  getCachedCode,
  getCachedCodeAsync,
  clearCodeCache,
  getCodeCacheSize,
}; 