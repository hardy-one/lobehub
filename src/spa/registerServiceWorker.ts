const SERVICE_WORKER_URL = '/_spa/sw.js';
const ROOT_SCOPE_PATH = '/';

export const SERVICE_WORKER_REGISTRATION_OPTIONS = {} satisfies RegistrationOptions;

const isBrowser = () =>
  import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator;

const isLegacyRootRegistration = (registration: ServiceWorkerRegistration) => {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) return false;

  return (
    new URL(registration.scope).pathname === ROOT_SCOPE_PATH &&
    new URL(worker.scriptURL).pathname === SERVICE_WORKER_URL
  );
};

/**
 * Remove the root-scoped worker from the first PWA implementation.
 *
 * The old worker served the desktop index.html for every navigation. Keep this
 * migration in both web entries so a client controlled by that worker can
 * recover without requiring the user to clear site data manually.
 */
export const unregisterLegacyRootServiceWorker = async (): Promise<boolean> => {
  if (!isBrowser()) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration(ROOT_SCOPE_PATH);
    if (!registration || !isLegacyRootRegistration(registration)) return false;

    return registration.unregister();
  } catch {
    return false;
  }
};

export const registerServiceWorker = () => {
  if (!isBrowser()) return;

  void unregisterLegacyRootServiceWorker()
    .then((unregistered) => {
      if (unregistered) {
        window.location.reload();
        return;
      }

      // Do not pass scope: '/'. The app shell is selected by the server per
      // user agent, so a worker must not control document navigations.
      void navigator.serviceWorker
        .register(SERVICE_WORKER_URL, SERVICE_WORKER_REGISTRATION_OPTIONS)
        .catch(() => {
          // A missing or unavailable worker must not affect the app shell.
        });
    })
    .catch(() => {
      // Service Worker support is optional and must not affect app startup.
    });
};
