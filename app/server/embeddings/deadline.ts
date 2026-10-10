/**
 * Run `fn` with a signal that aborts on the caller's signal, after `ms`, or as
 * soon as `fn` settles. Aborting on settle stops sibling requests (e.g. the
 * other batches of an embedMany) once one has failed, so nothing outlives the
 * attempt. The race also covers a transport that ignores aborts, so the
 * deadline holds: on timeout the result rejects with `timeoutError()`.
 */
export async function withDeadline<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutError: () => Error }
): Promise<T> {
  const { signal, timeoutError } = options;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = timeoutError();
      controller.abort(err);
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    // No-op if already aborted; otherwise cancels whatever `fn` left running.
    controller.abort(new DOMException("embedding attempt settled", "AbortError"));
  }
}
