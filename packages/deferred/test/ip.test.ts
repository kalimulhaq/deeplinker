import { describe, expect, it } from "vitest";
import { ipPrefix } from "../src/ip";

describe("ipPrefix", () => {
  it("keeps only the /24 of an IPv4 address", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix(" 10.1.2.3 ")).toBe("10.1.2.0/24");
  });

  it("reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(ipPrefix("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
  });

  it("keeps only the /48 of an IPv6 address, in a canonical form", () => {
    expect(ipPrefix("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
    expect(ipPrefix("2001:0DB8:0001::1")).toBe("2001:db8:1::/48");
    expect(ipPrefix("::1")).toBe("0:0:0::/48");
    expect(ipPrefix("fe80::1%eth0")).toBe("fe80:0:0::/48");
  });

  it("never returns anything that contains more of the address than the prefix", () => {
    for (const ip of ["203.0.113.77", "2001:db8:1:2:3:4:5:6"]) {
      const p = ipPrefix(ip) as string;
      expect(p).not.toContain("77");
      expect(p).not.toContain("5:6");
    }
  });

  it.each([
    null,
    undefined,
    "",
    "not an ip",
    "999.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "2001:db8::1::2",
    "gggg::1",
    "1:2:3",
  ])("rejects %j", (value) => {
    expect(ipPrefix(value as string)).toBeNull();
  });
});
