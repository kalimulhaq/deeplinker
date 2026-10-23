import { describe, expect, it } from "vitest";
import { compileRoute, compileRoutes, routeProblems } from "../src/paths/route";

const problems = (from: string, to: string | null) => routeProblems({ from, to });

describe("compileRoute", () => {
  it("compiles the path, the query and where each capture goes", () => {
    expect(
      compileRoute({
        from: "/property/:propertyId/leads?id=:leadId",
        to: "/property/leads?lead=:leadId&p=:propertyId",
      }),
    ).toEqual({
      p: "^/property/([^/]+)/leads(/?)$",
      q: [["id", "^([^]+)$"]],
      t: ["/property/leads?lead=", 1, "&p=", 0],
    });
  });

  it("numbers captures path first, then the query values in order, then the fragment", () => {
    const route = compileRoute({ from: "/a/:x?b=:y&c=:z#:w", to: "/:w/:z/:y/:x" });
    expect(route.t).toEqual(["/", 3, "/", 2, "/", 1, "/", 0]);
    expect(route.q).toEqual([
      ["b", "^([^]+)$"],
      ["c", "^([^]+)$"],
    ]);
    expect(route.f).toBe("^([^]+)$");
  });

  it("a path-only rule keeps the query, the fragment and the trailing slash; anything that mentions one does not", () => {
    expect(compileRoute({ from: "/a/:id", to: "/b/:id" }).k).toBe(1);
    expect(compileRoute({ from: "/a?x=:x", to: "/b" }).k).toBeUndefined();
    expect(compileRoute({ from: "/a", to: "/b?x=1" }).k).toBeUndefined();
    expect(compileRoute({ from: "/a#:f", to: "/b" }).k).toBeUndefined();
    expect(compileRoute({ from: "/a", to: "/b#frag" }).k).toBeUndefined();
  });

  it("refers to a * as written, with a negative number", () => {
    expect(compileRoute({ from: "/files/*", to: "/dl/*" })).toMatchObject({
      p: "^/files/(.*)(/?)$",
      t: ["/dl/", -1],
    });
    expect(compileRoute({ from: "/a/*/:id/*", to: "/*/:id/*" }).t).toEqual(["/", -1, "/", 1, "/", -3]);
  });

  it("escapes the literal text, a fixed value and a bare name", () => {
    const route = compileRoute({ from: "/a.b+c?type=x.y&debug&n=ref-:n", to: "/z" });
    expect(route.p).toBe("^/a\\.b\\+c(/?)$");
    expect(route.q).toEqual([
      ["type", "^x\\.y$"],
      ["debug", ""],
      ["n", "^ref-([^]+)$"],
    ]);
  });

  it("`to: null` compiles with its conditions", () => {
    expect(compileRoute({ from: "/app?x=1", to: null })).toEqual({
      p: "^/app(/?)$",
      q: [["x", "^1$"]],
      t: null,
      k: undefined,
    });
  });

  it("compileRoutes gives nothing for no rules", () => {
    expect(compileRoutes(undefined)).toBeUndefined();
    expect(compileRoutes([])).toBeUndefined();
  });
});

describe("routeProblems", () => {
  it("accepts the rules a person would write", () => {
    for (const [from, to] of [
      ["/property/:id", "/p/:id"],
      ["/property/:propertyId/leads?id=:leadId", "/property/leads?lead=:leadId&p=:propertyId"],
      ["/v/:v2/:snake_case", "/w/:snake_case/:v2"],
      ["/files/*", "/dl/*"],
      ["/app?lead=:id", "/applicants#:id"],
      ["/app", null],
      ["/a/:x?b=:y#:z", "/t/:y/:z?x=:x"],
      ["/x?debug", "/y"],
    ] as const) {
      expect(problems(from, to), `${from} -> ${to}`).toEqual([]);
    }
  });

  it("says where each rule is wrong", () => {
    expect(problems("property/:id", "/p/:id")).toEqual([
      { field: "from", message: '"property/:id" must start with "/".' },
    ]);
    expect(problems("/a", "b")).toEqual([{ field: "to", message: '"b" must start with "/".' }]);
  });

  it("catches a capture that `to` uses and `from` does not have, and says what it has", () => {
    expect(problems("/property/:propertyId/leads?id=:leadId", "/p/:id")).toEqual([
      { field: "to", message: ":id is not captured by from (the captures are :propertyId, :leadId)." },
    ]);
    expect(problems("/a", "/b/:id")[0]?.message).toBe(":id is not captured by from.");
  });

  it("asks for a name that starts with a letter, on either side", () => {
    const message =
      ":1 is not a name. Start each capture with a letter and say what it holds, such as :propertyId or :leadId.";
    expect(problems("/property/:1/leads?id=:2", "/p/:2/:1")).toEqual([{ field: "from", message }]);
    expect(problems("/property/:id", "/p/:1")).toEqual([{ field: "to", message }]);
  });

  it("catches the same name twice, a * where it cannot go, and too many *", () => {
    expect(problems("/a/:id?x=:id", "/b/:id")[0]).toMatchObject({
      field: "from",
      message: expect.stringContaining(":id appears twice"),
    });
    expect(problems("/a?x=*", "/b")[0]?.message).toContain("* is only for the path");
    expect(problems("/a#*", "/b")[0]?.message).toContain("* is only for the path");
    expect(problems("/a/*", "/b?x=*")[0]).toMatchObject({
      field: "to",
      message: expect.stringContaining("* is only for the path"),
    });
    expect(problems("/a/*", "/b/*/*")).toEqual([{ field: "to", message: "has 2 * but from only has 1." }]);
  });

  it("catches a query name that is not plain text", () => {
    expect(problems("/a?:x=1", "/b")[0]).toMatchObject({
      field: "from",
      message: expect.stringContaining('":x"'),
    });
    expect(problems("/a?x*y=1", "/b")[0]?.message).toContain('"x*y"');
  });
});
