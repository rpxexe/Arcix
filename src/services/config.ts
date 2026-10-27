// src/services/config.ts

/**
 * Returns the default signaling URL defined in .env (VITE_SIGNALING_URL) or fallback localhost.
 */
export const getDefaultSignalingUrl = (): string => {
  const envUrl = (import.meta.env.VITE_SIGNALING_URL as string | undefined)?.trim();
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }
  return 'ws://localhost:7070';
};

/**
 * Returns the active signaling server URL.
 * Order of priority:
 * 1. User custom override in localStorage (if explicitly set and not empty)
 * 2. .env configuration (VITE_SIGNALING_URL)
 * 3. Default ws://localhost:7070
 */
export const getSignalingUrl = (): string => {
  const savedUrl = localStorage.getItem('aerodesk_signaling_url')?.trim();
  const envUrl = (import.meta.env.VITE_SIGNALING_URL as string | undefined)?.trim();

  // If user has saved a custom override in localStorage
  if (savedUrl && savedUrl.length > 0) {
    // If savedUrl was the stale localhost default but .env specifies a cloud server,
    // automatically migrate to the .env server so user isn't stuck on local development server
    if (savedUrl === 'ws://localhost:7070' && envUrl && envUrl !== 'ws://localhost:7070') {
      localStorage.removeItem('aerodesk_signaling_url');
      return envUrl;
    }
    return savedUrl;
  }

  // Next prioritize .env
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }

  return 'ws://localhost:7070';
};

/**
 * Saves or resets custom signaling server URL.
 */
export const saveSignalingUrl = (url: string | null) => {
  const trimmed = url?.trim() || '';
  const defaultUrl = getDefaultSignalingUrl();
  if (!trimmed || trimmed === defaultUrl) {
    localStorage.removeItem('aerodesk_signaling_url');
  } else {
    localStorage.setItem('aerodesk_signaling_url', trimmed);
  }
};
