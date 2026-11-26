import { useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ok'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: Error };

/** deps 가 바뀌면 이전 요청을 끊고 다시 부른다 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fn(ac.signal).then(
      data => { if (!ac.signal.aborted) setState({ status: 'ok', data }); },
      (error: Error) => { if (!ac.signal.aborted) setState({ status: 'error', error }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce(n => n + 1) };
}
