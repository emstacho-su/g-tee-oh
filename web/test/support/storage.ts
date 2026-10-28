/**
 * Test helpers (S32, O-323): an in-memory Storage and a Storage whose every call throws, the two
 * environments the guarded preference stores must survive.
 */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

export function throwingStorage(): Storage {
  const fail = (): never => {
    throw new Error("storage blocked");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}
