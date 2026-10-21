import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readRoute(): string {
  let hash = window.location.hash;
  if (hash.startsWith('#')) hash = hash.slice(1);
  if (hash.startsWith('/')) hash = hash.slice(1);
  return hash;
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, readRoute);
}
