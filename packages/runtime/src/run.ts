import {
  decide,
  type DecideContext,
  type Decision,
  type Env,
  type RuntimeConfig,
  type Target,
} from "@deeplinker/core/runtime";
import { readEnv, relatedAppInstalled } from "./env";
import { emit } from "./events";
import { guardState, setGuard } from "./guard";

export interface Resolution {
  env: Env;
  decision: Decision;
}

/** Detect, decide, announce. Acts on nothing. */
export function resolveDecision(config: RuntimeConfig): Promise<Resolution> {
  return readEnv().then((env) => {
    emit("detect", env);
    const [guardSet, storageOk] = guardState();
    const ctx: DecideContext = {
      env,
      href: location.href,
      config,
      guardSet,
      storageOk,
      relatedAppInstalled: undefined,
    };
    const first = decide(ctx);
    // Only worth asking the browser about installed apps when something is about to be shown or sent.
    const pending = first.action !== "none" && first.action !== "escape";
    return (pending ? relatedAppInstalled() : Promise.resolve(false)).then((installed) => {
      const decision = installed ? decide(Object.assign({}, ctx, { relatedAppInstalled: true })) : first;
      emit("decision", decision);
      return { env, decision };
    });
  });
}

let reported = false;

/**
 * Deferred deep linking: tells your own endpoint about a click that is about to reach a store, so the app can ask for
 * the page after the install. Once per page, and best effort: it must never stop the visitor reaching the store.
 */
function report(config: RuntimeConfig): void {
  if (reported || !config.deferred) return;
  reported = true;
  try {
    navigator.sendBeacon(config.deferred.url, JSON.stringify({ url: location.href }));
  } catch {
    /* no beacon support: the visitor still reaches the store */
  }
}

/** Every store and download link in the config, as written. */
export function storeUrls(config: RuntimeConfig): string[] {
  const { ios, android, macos, windows, linux } = config.apps;
  const out: (string | undefined)[] = [ios && ios.storeUrl];
  if (android) for (const id of android.priority) out.push(android.stores[id]);
  if (macos) out.push(macos.storeUrl, macos.downloadUrl);
  if (windows) out.push(windows.storeUrl, windows.downloadUrl);
  if (linux) out.push(linux.stores.flathub, linux.stores.snap, linux.downloadUrl);
  return out.filter(Boolean) as string[];
}

/** Sets the loop guard, announces it, reports a store click, then navigates. `replace` keeps the page out of history. */
export function navigate(target: Target, config: RuntimeConfig, replace: boolean, decision?: Decision): void {
  setGuard();
  emit("redirect", { target, decision });
  if (target.kind === "store") report(config);
  if (replace) location.replace(target.url);
  else location.href = target.url;
}

/**
 * When the page stays and offers the store itself, a tap on a link to it is reported as a redirect would be. Only
 * listens: the click goes ahead untouched, and nothing on the page changes.
 */
function watchStoreLinks(config: RuntimeConfig, store: Target): void {
  const urls = storeUrls(config).concat(store.url);
  const page = () => location.href.split("#")[0];
  const here = page();
  document.addEventListener(
    "click",
    (e) => {
      // A single-page app keeps this listener after it moves on to another page, which this decision was not for.
      if (page() !== here) return;
      const el = e.target as Element | null;
      const link = el && el.closest ? (el.closest("a[href]") as HTMLAnchorElement | null) : null;
      if (link && (urls.indexOf(link.href) >= 0 || urls.indexOf(link.getAttribute("href") as string) >= 0)) {
        setGuard();
        report(config);
      }
    },
    true,
  );
}

/**
 * Does what the decision says: navigate, or leave the page exactly as it is. It never adds or changes anything on the
 * page. Every decision has already been announced (`deeplinker:decision`, with the ready-made links in `choices`), so
 * a page that wants to offer "Open in app" or "Get the app" does it in its own design. The loop guard is always set
 * before a navigation.
 */
export function act({ decision: d }: Resolution, config: RuntimeConfig): void {
  if (d.action === "redirect" || d.action === "intent") {
    const target = d.target as Target;
    const go = () => navigate(target, config, d.action !== "intent", d);
    if (d.delayMs > 0) setTimeout(go, d.delayMs);
    else go();
    return;
  }
  if (d.reason === "skip-param") setGuard();
  if (config.deferred && d.choices.store) watchStoreLinks(config, d.choices.store);
  emit("stay", { reason: d.reason });
}
