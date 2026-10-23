export type EventName = "detect" | "decision" | "redirect" | "stay" | "error";
type Handler = (detail: unknown) => void;

const handlers: Record<string, Handler[]> = {};
let debug = false;

/** With `debug: true` every event is also written to the console. Nothing is ever logged otherwise. */
export const setDebug = (on: boolean) => {
  debug = on;
};

/** Subscribes to an event. Returns the function that unsubscribes. */
export function on(name: EventName, handler: Handler): () => void {
  (handlers[name] = handlers[name] || []).push(handler);
  return () => {
    handlers[name] = (handlers[name] || []).filter((h) => h !== handler);
  };
}

/** Calls the subscribers, then dispatches `deeplinker:<name>` on window. A faulty handler never reaches the page. */
export function emit(name: EventName, detail: unknown): void {
  if (debug) console.log("[deeplinker]", name, detail);
  (handlers[name] || []).slice().forEach((h) => {
    try {
      h(detail);
    } catch {
      /* a handler's mistake is not ours to surface */
    }
  });
  try {
    window.dispatchEvent(new CustomEvent("deeplinker:" + name, { detail }));
  } catch {
    /* no CustomEvent: the handlers above still ran */
  }
}
