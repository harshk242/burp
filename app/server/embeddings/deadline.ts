/**
 * Settle with `promise`, or reject with `signal.reason` as soon as `signal`
 * aborts, whichever comes first. The caller is released even when the
 * underlying operation ignores the abort and keeps running.
 */
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Run `fn` with a signal that aborts on the caller's signal, after `ms`, or as
 * soon as `fn` settles. Aborting on settle stops sibling requests (e.g. the
 * other batches of an embedMany) once one has failed, so nothing outlives the
 * attempt. The race also covers a transport that ignores aborts, so neither
 * the deadline nor the caller's abort waits on it: on timeout the result
 * rejects with `timeoutError()`, on abort with the caller's `signal.reason`.
 */
export async function withDeadline<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutError: () => Error }
): Promise<T> {
  const { signal, timeoutError } = options;
  signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = timeoutError();
      controller.abort(err);
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([untilAborted(fn(controller.signal), signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    controller.abort(new DOMException("embedding attempt settled", "AbortError"));
  }
}
