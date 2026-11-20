// Stable element ids. Random (not sequential) so two people editing the same project in
// different branches never produce the same id, which keeps git merges clean.

/** @returns {string} a 16-character lowercase hex id */
export function newId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {unknown} id */
export const isId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
