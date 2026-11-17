import { useSyncExternalStore } from 'react';
import { BRIDGE_CHANGED_EVENT, BridgeConfig, getBridgeConfig } from '../api/google-bridge';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(BRIDGE_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(BRIDGE_CHANGED_EVENT, onChange);
}

/** Live view of the Google bridge settings; re-renders when they change. */
export function useBridgeConfig(): BridgeConfig {
  return useSyncExternalStore(subscribe, getBridgeConfig, getBridgeConfig);
}
