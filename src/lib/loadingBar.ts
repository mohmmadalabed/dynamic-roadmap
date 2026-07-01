// Tiny global loading indicator store — no external deps.
// Any part of the app can call start()/done() (or wrap an async call with
// track()) and the top-of-page <LoadingBar /> will reflect it. Counter-based
// so overlapping calls (e.g. route chunk load + data fetch) don't hide the
// bar until everything finishes.

type Listener = (active: boolean) => void

let count = 0
const listeners = new Set<Listener>()

function notify() {
  const active = count > 0
  listeners.forEach(l => l(active))
}

export function start() {
  count += 1
  notify()
}

export function done() {
  count = Math.max(0, count - 1)
  notify()
}

/** Wrap an async call so the bar shows for its duration, even if it throws.
 *  Accepts PromiseLike (not just Promise) so Supabase query builders — which
 *  are thenable but not full Promise instances — can be passed directly. */
export async function track<T>(promise: PromiseLike<T>): Promise<T> {
  start()
  try {
    return await promise
  } finally {
    done()
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  listener(count > 0)
  return () => listeners.delete(listener)
}
