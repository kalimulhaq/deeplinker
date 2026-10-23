import { describe, expect, it } from "vitest";
import { compileRoutes } from "../src/paths/route";
import { joinUrl, splitUrl, toWebAppUrl } from "../src/runtime";

describe("splitUrl", () => {
  it("splits origin, path, query and hash without touching them", () => {
    expect(splitUrl("https://example.com/property/42?a=1#top")).toEqual({
      origin: "https://example.com",
      pathname: "/property/42",
      search: "?a=1",
      hash: "#top",
    });
  });

  it("reports an empty path as /", () => {
    expect(splitUrl("https://example.com?x=1")).toMatchObject({ pathname: "/", search: "?x=1" });
  });

  it("keeps a trailing ? and a lone #", () => {
    expect(splitUrl("https://example.com/p?")).toMatchObject({ search: "?", hash: "" });
    expect(splitUrl("https://example.com/p#")).toMatchObject({ search: "", hash: "#" });
    expect(splitUrl("https://example.com/p?#")).toMatchObject({ search: "?", hash: "#" });
  });

  it("keeps a ? that appears after the # inside the hash", () => {
    expect(splitUrl("https://example.com/app#/spa/route?x=1")).toEqual({
      origin: "https://example.com",
      pathname: "/app",
      search: "",
      hash: "#/spa/route?x=1",
    });
  });

  it("accepts a bare path", () => {
    expect(splitUrl("/p/1?a=1#h")).toEqual({ origin: "", pathname: "/p/1", search: "?a=1", hash: "#h" });
  });
});

describe("query and hash survive a web-app redirect byte for byte", () => {
  const web = {
    url: "https://app.example.com",
    routes: compileRoutes([{ from: "/property/:id", to: "/p/:id" }]),
  };
  const via = (href: string) => toWebAppUrl(splitUrl(href), web);

  it("preserves ?a=1&a=2&b=&c byte-for-byte", () => {
    expect(via("https://example.com/property/7?a=1&a=2&b=&c")).toBe(
      "https://app.example.com/p/7?a=1&a=2&b=&c",
    );
  });

  it("keeps + and %20 distinct", () => {
    expect(via("https://example.com/property/7?q=a+b&r=a%20b")).toBe(
      "https://app.example.com/p/7?q=a+b&r=a%20b",
    );
  });

  it("keeps unicode and percent-encoded unicode as given", () => {
    expect(via("https://example.com/property/7?city=Zürich&c2=Z%C3%BCrich")).toBe(
      "https://app.example.com/p/7?city=Zürich&c2=Z%C3%BCrich",
    );
    expect(via("https://example.com/property/caf%C3%A9")).toBe("https://app.example.com/p/caf%C3%A9");
  });

  it("keeps a trailing ? and a lone #", () => {
    expect(via("https://example.com/property/7?")).toBe("https://app.example.com/p/7?");
    expect(via("https://example.com/property/7#")).toBe("https://app.example.com/p/7#");
  });

  it("keeps #/spa/route?x=1 right after the mapped path", () => {
    expect(via("https://example.com/property/7#/spa/route?x=1")).toBe(
      "https://app.example.com/p/7#/spa/route?x=1",
    );
  });

  it("keeps parameter order", () => {
    expect(via("https://example.com/property/7?z=1&a=2&m=3")).toBe("https://app.example.com/p/7?z=1&a=2&m=3");
  });
});

describe("web target", () => {
  it("prefixes the base path of url and ignores its trailing slash", () => {
    const loc = splitUrl("https://example.com/listing/9?x=1#y");
    expect(toWebAppUrl(loc, { url: "https://example.com/app/" })).toBe(
      "https://example.com/app/listing/9?x=1#y",
    );
    expect(toWebAppUrl(loc, { url: "https://app.example.com" })).toBe(
      "https://app.example.com/listing/9?x=1#y",
    );
  });

  it("drops a query or hash that was typed into url itself", () => {
    expect(joinUrl("https://app.example.com/?utm=1#x", "/p", "?a=1", "")).toBe(
      "https://app.example.com/p?a=1",
    );
  });
});
