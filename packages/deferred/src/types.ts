/** What the server remembers about one click that ended at an app store. Nothing here identifies a person. */
export interface ClickRecord {
  id: string;
  /** The URL the visitor opened: the one the app should open on first launch. */
  url: string;
  /** Milliseconds since the epoch. */
  ts: number;
  /** IPv4 /24 or IPv6 /48, never the full address. */
  ipPrefix: string;
  os: string;
  /** Major OS version ("17"), or "". */
  osMajor: string;
  deviceClass: string;
  /** Primary language subtag ("en"), or "". */
  lang: string;
}

/** Where clicks are kept until the app asks for them or they expire. */
export interface Store {
  /** Keep `record` for `ttlSeconds`. */
  put(record: ClickRecord, ttlSeconds: number): Promise<void>;
  /** The unexpired records for this prefix at time `now`, newest first, at most 50. */
  findByPrefix(prefix: string, now: number): Promise<ClickRecord[]>;
  delete(id: string, prefix: string): Promise<void>;
}

export interface Settings {
  /** Host names whose URLs are accepted: your `domain` and `additionalDomains`. */
  hosts: string[];
  /** How long a click can be matched. */
  ttlSeconds: number;
  /** Accept a URL read from the iOS pasteboard (the app asks the user for paste permission). */
  clipboard: boolean;
}

export type MatchKind = "deterministic" | "clipboard" | "probabilistic" | "none";

export interface MatchResponse {
  match: MatchKind;
  url?: string;
  /** 0 to 1; only for `probabilistic`. Treat it as a hint, not a fact. */
  confidence?: number;
}

export interface MatchRequest {
  platform?: "ios" | "android" | "other";
  osVersion?: string;
  deviceClass?: "phone" | "tablet" | "desktop";
  language?: string;
  /** Android: the Play Install Referrer string. */
  installReferrer?: string;
  /** The text read from the pasteboard, when the clipboard method is on. */
  clipboard?: string;
}
