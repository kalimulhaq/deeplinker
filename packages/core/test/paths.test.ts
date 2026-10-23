import { describe, expect, it } from "vitest";
import { matchesDeepLinkPath, splitUrl, toWebAppUrl } from "../src/runtime";
import { compileRoutes } from "../src/paths/route";
import type { PathMapRule } from "../src/types";

const at = (href: string) => splitUrl("https://example.com" + href);

describe("matchesDeepLinkPath", () => {
  it("matches everything when no paths are configured", () => {
    expect(matchesDeepLinkPath(at("/anything?x=1"), undefined)).toBe(true);
    expect(matchesDeepLinkPath(at("/"), {})).toBe(true);
  });

  it("matches include patterns with * across segments", () => {
    const paths = { include: ["/property/*", "/listing/*"] };
    expect(matchesDeepLinkPath(at("/property/42"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/property/42/photos"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/listing/1?x=1"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/about"), paths)).toBe(false);
    expect(matchesDeepLinkPath(at("/"), paths)).toBe(false);
  });

  it("exclude beats include", () => {
    const paths = { include: ["/property/*"], exclude: ["/property/private/*"] };
    expect(matchesDeepLinkPath(at("/property/42"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/property/private/9"), paths)).toBe(false);
  });

  it("empty include matches everything except excludes", () => {
    const paths = { exclude: ["/admin/*"] };
    expect(matchesDeepLinkPath(at("/anything"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/admin/users"), paths)).toBe(false);
  });

  it("treats regex characters in patterns literally", () => {
    const paths = { include: ["/a.b/(x)+/*"] };
    expect(matchesDeepLinkPath(at("/a.b/(x)+/1"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/aXb/(x)+/1"), paths)).toBe(false);
  });

  it("? matches one character and ?* matches one or more, as in Apple's components", () => {
    expect(matchesDeepLinkPath(at("/p/a"), { include: ["/p/?"] })).toBe(true);
    expect(matchesDeepLinkPath(at("/p/ab"), { include: ["/p/?"] })).toBe(false);
    expect(matchesDeepLinkPath(at("/p/"), { include: ["/p/*"] })).toBe(true);
    expect(matchesDeepLinkPath(at("/p/"), { include: ["/p/?*"] })).toBe(false);
    expect(matchesDeepLinkPath(at("/p/abc"), { include: ["/p/?*"] })).toBe(true);
  });

  it("paths are case-sensitive, like URLs", () => {
    expect(matchesDeepLinkPath(at("/Property/1"), { include: ["/property/*"] })).toBe(false);
  });

  it("a query rule { ref: '*' } requires ref to be present", () => {
    const paths = { include: [{ path: "/p/*", query: { ref: "*" } }] };
    expect(matchesDeepLinkPath(at("/p/1?ref=abc"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/p/1?ref="), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/p/1?other=1&ref=x"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/p/1"), paths)).toBe(false);
    expect(matchesDeepLinkPath(at("/p/1?other=1"), paths)).toBe(false);
  });

  it("a query value pattern is matched against the decoded value", () => {
    const paths = { include: [{ query: { city: "Z?rich" } }] };
    expect(matchesDeepLinkPath(at("/x?city=Z%C3%BCrich"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/x?city=Zurich"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/x?city=Zrich"), paths)).toBe(false);
  });

  it("* and ? also match a line break inside a decoded query value", () => {
    const paths = { include: [{ query: { q: "*" } }] };
    expect(matchesDeepLinkPath(at("/x?q=a%0Ab"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/x?q=a%E2%80%A8b"), paths)).toBe(true); // U+2028
    expect(matchesDeepLinkPath(at("/x?q=%0A"), { include: [{ query: { q: "?" } }] })).toBe(true);
    expect(matchesDeepLinkPath(at("/x?q=%0A%0A"), { include: [{ query: { q: "?" } }] })).toBe(false);
  });

  it("a fragment rule matches the hash without the #", () => {
    const paths = { exclude: [{ fragment: "no_universal_links" }] };
    expect(matchesDeepLinkPath(at("/x#no_universal_links"), paths)).toBe(false);
    expect(matchesDeepLinkPath(at("/x#other"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/x"), paths)).toBe(true);
  });

  it("a rule with several keys needs all of them to match", () => {
    const paths = { include: [{ path: "/p/*", fragment: "top" }] };
    expect(matchesDeepLinkPath(at("/p/1#top"), paths)).toBe(true);
    expect(matchesDeepLinkPath(at("/p/1#bottom"), paths)).toBe(false);
    expect(matchesDeepLinkPath(at("/q/1#top"), paths)).toBe(false);
  });
});

const WEB = "https://web.example";
const webUrl = (href: string, routes: PathMapRule[] | undefined) =>
  toWebAppUrl(at(href), { url: WEB, routes: compileRoutes(routes) });
/** What a rule does to the path alone: the part of the web URL before any query or hash. */
const mapped = (path: string, map: PathMapRule[]) => (webUrl(path, map) as string).slice(WEB.length);

describe("routing rules: path rules", () => {
  const map = [
    { from: "/property/:id", to: "/p/:id" },
    { from: "/property/*", to: "/legacy/*" },
    { from: "/blog/:year/:slug", to: "/articles/:slug/:year" },
  ];

  it("maps :param segments", () => {
    expect(mapped("/property/42", map)).toBe("/p/42");
    expect(mapped("/blog/2026/hello", map)).toBe("/articles/hello/2026");
  });

  it("first match wins", () => {
    expect(mapped("/property/42", map)).toBe("/p/42");
    expect(mapped("/property/42/photos", map)).toBe("/legacy/42/photos");
  });

  it("goes to the same path when nothing matches", () => {
    expect(mapped("/about", map)).toBe("/about");
    expect(mapped("/about", [])).toBe("/about");
    expect(webUrl("/about", undefined)).toBe(`${WEB}/about`);
    expect(webUrl("/about?a=1#x", map)).toBe(`${WEB}/about?a=1#x`);
  });

  it("keeps a trailing slash", () => {
    expect(mapped("/property/42/", map)).toBe("/p/42/");
  });

  it("keeps the original query and hash, byte for byte", () => {
    expect(webUrl("/property/42?a=1&a=2&b=#top", map)).toBe(`${WEB}/p/42?a=1&a=2&b=#top`);
  });

  it("does not match a :param against an empty segment", () => {
    expect(mapped("/property/", [{ from: "/property/:id", to: "/p/:id" }])).toBe("/property/");
  });

  it("a * is anything, slashes included, and comes out exactly as it was written", () => {
    expect(mapped("/property/42/photos/a%2Fb", map)).toBe("/legacy/42/photos/a%2Fb");
    expect(mapped("/files/a/b+c/d", [{ from: "/files/*", to: "/dl/*" }])).toBe("/dl/a/b+c/d");
  });

  it("a :param is decoded and encoded again: safe anywhere, and the same for ordinary text", () => {
    expect(mapped("/property/caf%C3%A9", map)).toBe("/p/caf%C3%A9");
    expect(mapped("/property/a%20b", map)).toBe("/p/a%20b");
    expect(mapped("/property/a+b", map)).toBe("/p/a%2Bb"); // a plus in a path is a plus, never a space
  });

  it("captures can be used in any order", () => {
    expect(mapped("/blog/2026/hello", [{ from: "/blog/:year/:slug", to: "/articles/:slug/:year" }])).toBe(
      "/articles/hello/2026",
    );
  });
});

describe("routing rules: any part of the URL to any part of the target", () => {
  const WEBAPP = {
    from: "/property/:propertyId/leads?id=:leadId",
    to: "/property/leads?lead=:leadId&p=:propertyId",
  };

  it("moves a path segment into a query value, and a query value into another", () => {
    expect(webUrl("/property/42/leads?id=abc", [WEBAPP])).toBe(`${WEB}/property/leads?lead=abc&p=42`);
  });

  it("builds the target from `to` alone: the rest of the query and the fragment are not carried over", () => {
    expect(webUrl("/property/42/leads?id=abc&token=secret&utm=x#frag", [WEBAPP])).toBe(
      `${WEB}/property/leads?lead=abc&p=42`,
    );
  });

  it("does not match without the parameter, or with an empty or blank one", () => {
    for (const href of [
      "/property/42/leads",
      "/property/42/leads?id=",
      "/property/42/leads?id=%20",
      "/property/42/leads?x=1",
    ]) {
      expect(webUrl(href, [WEBAPP]), href).toBe(`${WEB}${href}`); // no rule: the same URL on the web app
    }
  });

  it("the parameters can come in any order, among others", () => {
    expect(webUrl("/property/42/leads?z=1&id=abc&y=2", [WEBAPP])).toBe(`${WEB}/property/leads?lead=abc&p=42`);
  });

  it("any part can go to any part: path to fragment, query to path, fragment to query", () => {
    const rule = { from: "/a/:x?b=:y#:z", to: "/t/:y/:z?x=:x#:y" };
    expect(webUrl("/a/1?b=2#3", [rule])).toBe(`${WEB}/t/2/3?x=1#2`);
    expect(webUrl("/a/1?b=2", [rule])).toBe(`${WEB}/a/1?b=2`); // the fragment is required
  });

  it("matches a fixed value, so one path can mean different things", () => {
    const rules = [
      { from: "/go?type=lead&id=:id", to: "/applicants#:id" },
      { from: "/go?type=owner&id=:id", to: "/properties/:id" },
    ];
    expect(webUrl("/go?type=lead&id=7", rules)).toBe(`${WEB}/applicants#7`);
    expect(webUrl("/go?id=7&type=owner", rules)).toBe(`${WEB}/properties/7`);
    expect(webUrl("/go?type=other&id=7", rules)).toBe(`${WEB}/go?type=other&id=7`);
  });

  it("matches text around a capture inside a value", () => {
    const rule = { from: "/p?ref=ref-:n", to: "/r/:n" };
    expect(webUrl("/p?ref=ref-42", [rule])).toBe(`${WEB}/r/42`);
    expect(webUrl("/p?ref=other", [rule])).toBe(`${WEB}/p?ref=other`);
  });

  it("a bare ?name only needs the parameter to be there", () => {
    const rule = { from: "/x?debug", to: "/y" };
    expect(webUrl("/x?debug", [rule])).toBe(`${WEB}/y`);
    expect(webUrl("/x?debug=1&z=2", [rule])).toBe(`${WEB}/y`);
    expect(webUrl("/x?z=2", [rule])).toBe(`${WEB}/x?z=2`);
  });

  it("a rule that only reads the query still builds the target exactly, with no trailing slash", () => {
    expect(webUrl("/x/?debug=1", [{ from: "/x?debug", to: "/y" }])).toBe(`${WEB}/y`);
  });

  it("decodes values (a plus is a space), trims them, and encodes them again", () => {
    const rule = { from: "/p?v=:v", to: "/q/:v#:v" };
    expect(webUrl("/p?v=%20abc%20", [rule])).toBe(`${WEB}/q/abc#abc`);
    expect(webUrl("/p?v=a+b", [rule])).toBe(`${WEB}/q/a%20b#a%20b`);
    expect(webUrl("/p?v=a%2Fb%23c", [rule])).toBe(`${WEB}/q/a%2Fb%23c#a%2Fb%23c`);
    expect(webUrl("/p?v=%E4%BD%A0", [rule])).toBe(`${WEB}/q/%E4%BD%A0#%E4%BD%A0`);
  });

  it("reads the fragment decoded too", () => {
    expect(webUrl("/a#a%20b", [{ from: "/a#:id", to: "/b/:id" }])).toBe(`${WEB}/b/a%20b`);
    expect(webUrl("/a", [{ from: "/a#:id", to: "/b/:id" }])).toBe(`${WEB}/a`);
  });

  it("uses the first value of a repeated parameter, as URLSearchParams does", () => {
    const rule = { from: "/p?v=:v", to: "/q/:v" };
    expect(webUrl("/p?v=1&v=2", [rule])).toBe(`${WEB}/q/1`);
    expect(webUrl("/p?v=&v=2", [rule])).toBe(`${WEB}/p?v=&v=2`);
    expect(webUrl("/p?v&v=2", [rule])).toBe(`${WEB}/p?v&v=2`);
  });

  it("the first rule that matches wins, whatever order the URL has things in", () => {
    const rules = [
      { from: "/app?lead=:id", to: "/applicants#:id" },
      { from: "/app?owner_lead=:id", to: "/properties/:id" },
      { from: "/app?listing=:id", to: "/explore/listings#:id" },
    ];
    expect(webUrl("/app?listing=L&owner_lead=O&lead=A", rules)).toBe(`${WEB}/applicants#A`);
    expect(webUrl("/app?listing=L&owner_lead=O", rules)).toBe(`${WEB}/properties/O`);
    expect(webUrl("/app?lead=&owner_lead=7", rules)).toBe(`${WEB}/properties/7`);
  });

  it("`to: null` says there is no web equivalent, and still respects the conditions in `from`", () => {
    const rules = [
      { from: "/app?lead=:id", to: "/applicants#:id" },
      { from: "/app", to: null },
      { from: "/gone?why=:w", to: null },
    ];
    expect(webUrl("/app?lead=1", rules)).toBe(`${WEB}/applicants#1`);
    expect(webUrl("/app", rules)).toBeUndefined();
    expect(webUrl("/app/?token=x", rules)).toBeUndefined();
    expect(webUrl("/gone?why=moved", rules)).toBeUndefined();
    expect(webUrl("/gone", rules)).toBe(`${WEB}/gone`);
  });

  it("keeps a path prefix on url", () => {
    expect(
      toWebAppUrl(at("/property/42/leads?id=abc"), {
        url: "https://example.com/web/",
        routes: compileRoutes([WEBAPP]),
      }),
    ).toBe("https://example.com/web/property/leads?lead=abc&p=42");
  });
});
