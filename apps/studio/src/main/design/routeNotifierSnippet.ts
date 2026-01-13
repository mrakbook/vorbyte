/**
 * Drop-in snippet to notify the parent (Studio) whenever the preview's route changes.
 *
 * This is useful for a v0.app-style browser UI (Back/Forward history + address bar).
 *
 * Usage idea (in your preview bridge / injected script):
 *
 *   import { installVorbyteRouteNotifier } from './routeNotifierSnippet'
 *   installVorbyteRouteNotifier();
 */

export function installVorbyteRouteNotifier(): void {
  const notify = () => {
    try {
      window.parent?.postMessage(
        { kind: 'vorbyte:design', type: 'route', route: window.location.pathname + window.location.search + window.location.hash },
        '*'
      );
    } catch {
      // ignore
    }
  };

  // Hook SPA navigation
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    // eslint-disable-next-line prefer-rest-params
    origPush.apply(this, args as any);
    notify();
  } as any;

  history.replaceState = function (...args) {
    // eslint-disable-next-line prefer-rest-params
    origReplace.apply(this, args as any);
    notify();
  } as any;

  window.addEventListener('popstate', notify);
  notify();
}
