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
