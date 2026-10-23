// RFC 3492 Punycode encoder. core has no DOM and no Node types, so `URL` is not available to turn
// "bücher.example" into "xn--bcher-kva.example". Only the encoder is needed.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function digit(d: number): string {
  return String.fromCharCode(d < 26 ? d + 97 : d + 22);
}

function encodeLabel(input: string): string {
  const cps = Array.from(input, (c) => c.codePointAt(0) as number);
  let out = cps
    .filter((c) => c < 128)
    .map((c) => String.fromCharCode(c))
    .join("");
  const basic = out.length;
  let handled = basic;
  if (basic > 0) out += "-";

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;

  while (handled < cps.length) {
    let m = Infinity;
    for (const c of cps) if (c >= n && c < m) m = c;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          out += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += digit(q);
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

function isASCII(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return false;
  return true;
}

/** Converts each non-ASCII label of a host name to `xn--…`. ASCII labels are returned unchanged. */
export function toASCII(host: string): string {
  return host
    .split(".")
    .map((label) => (isASCII(label) ? label : "xn--" + encodeLabel(label.normalize("NFC"))))
    .join(".");
}
