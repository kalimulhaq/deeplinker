/**
 * The only part of an address that is ever stored: IPv4 /24 ("203.0.113.0/24") or IPv6 /48 ("2001:db8:1::/48").
 * Returns null for anything that is not an address, so a garbage header never becomes a key.
 */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const text = ip.trim();

  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(text);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3]].map(Number);
    return octets.every((o) => o <= 255) ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : null;
  }
  if (!text.includes(":")) return null;

  const address = text.split("%")[0] as string; // drop a zone id
  if (!/^[0-9a-f:]+$/i.test(address)) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail = halves[1] ? (halves[1] as string).split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const groups =
    halves.length === 1
      ? head
      : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return (
    groups
      .slice(0, 3)
      .map((g) => Number.parseInt(g, 16).toString(16))
      .join(":") + "::/48"
  );
}
