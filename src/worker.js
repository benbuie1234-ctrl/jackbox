export { Room } from './room.js';

// No vowels / confusable letters -> no accidental words, no I/O/1/0 mix-ups.
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

function newCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return c;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Create a room (TV calls this).
    if (url.pathname === '/api/new' && request.method === 'POST') {
      for (let tries = 0; tries < 8; tries++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.init(code);
        if (res.ok) return json({ code, hostKey: res.hostKey });
      }
      return json({ error: 'Could not create a room, try again.' }, 500);
    }

    // Does a room exist? (phone join screen check)
    const m = url.pathname.match(/^\/api\/room\/([A-Z]{4})$/);
    if (m) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return json(await stub.info());
    }

    // WebSocket into a room.
    const w = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (w) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(w[1]));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
