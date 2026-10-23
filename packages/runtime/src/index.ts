import type { Decision, RuntimeConfig, Target } from "@deeplinker/core/runtime";
import { emit, on, setDebug } from "./events";
import { act, navigate, resolveDecision, storeUrls } from "./run";

export type { Decision, Env, RuntimeConfig, Target } from "@deeplinker/core/runtime";
export type { EventName } from "./events";
export { on };

const NO_CONFIG = "deeplinker: init(config) first";
let config: RuntimeConfig | undefined;
let started = false;

const FAILED: Decision = { action: "none", reason: "error", choices: {}, linkHandling: "none", delayMs: 0 };

function fail(error: unknown): Decision {
  emit("error", { error });
  return FAILED;
}

function run(doAct: boolean): Promise<Decision> {
  return Promise.resolve()
    .then(() => {
      const cfg = config;
      if (!cfg) throw new Error(NO_CONFIG);
      return resolveDecision(cfg).then((resolution) => {
        if (doAct) act(resolution, cfg);
        return resolution.decision;
      });
    })
    .catch(fail);
}

/** Decides what to do for this visitor without doing it. For building your own UI. */
export const resolve = (): Promise<Decision> => run(false);

/** Decides, then does it: redirect, or stay and leave the page as it is. */
export const open = (): Promise<Decision> => run(true);

/**
 * Takes the visitor to one of the decision's `choices`, the way an automatic redirect would: sets the loop guard,
 * reports a store click to your deferred endpoint, then navigates. For the buttons your page draws itself:
 * `button.onclick = () => DeepLinker.go(decision.choices.store)`. Never throws.
 */
export function go(to: Target | string): void {
  try {
    const cfg = config;
    if (!cfg) throw new Error(NO_CONFIG);
    const target: Target =
      typeof to === "string"
        ? {
            kind: /^intent:/.test(to) ? "intent" : storeUrls(cfg).indexOf(to) >= 0 ? "store" : "web",
            url: to,
          }
        : to;
    navigate(target, cfg, false);
  } catch (error) {
    fail(error);
  }
}

/**
 * Sets the config and, unless `options.run` is false, runs the routing straight away. The generated deeplinker.js calls
 * this with the config inlined. Only the first call counts. Never throws.
 */
export function init(cfg?: RuntimeConfig, options?: { run?: boolean }): void {
  try {
    if (started) return;
    if (!cfg || typeof cfg !== "object") throw new Error(NO_CONFIG);
    config = cfg;
    started = true;
    setDebug(cfg.debug);
    if (!options || options.run !== false) open();
  } catch (error) {
    fail(error);
  }
}

export const DeepLinker = { init, resolve, open, go, on };
