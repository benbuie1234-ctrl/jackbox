export const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Pick n items, avoiding ones already used this session where possible.
export function deal(pool, n, used = []) {
  const usedSet = new Set(used);
  const fresh = shuffle(pool.filter((x) => !usedSet.has(keyOf(x))));
  const stale = shuffle(pool.filter((x) => usedSet.has(keyOf(x))));
  return [...fresh, ...stale].slice(0, n);
}
export const keyOf = (x) => (typeof x === 'string' ? x : x.q || x.text);
export const cleanText = (t, max = 80) =>
  String(t || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
