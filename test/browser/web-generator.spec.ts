// The web generator, built (apps/web-generator/dist) and served from localhost, driven like a person would.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";
import { asText, readZip } from "../../apps/web-generator/test/zip-reader";

const dist = resolve(import.meta.dirname, "../../apps/web-generator/dist");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let server: Server;
let origin = "";

test.beforeAll(async () => {
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error("The web generator is not built. Run: pnpm --filter @deeplinker/web-generator build");
  }
  server = createServer((req, res) => {
    const name =
      (req.url ?? "/").split("?")[0] === "/" ? "/index.html" : ((req.url ?? "").split("?")[0] ?? "");
    const file = join(dist, name);
    if (!file.startsWith(dist) || !existsSync(file)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => void server.close());

/** Opens the page and records what the browser asks for and what it complains about. */
async function open(page: Page) {
  const requests: string[] = [];
  const problems: string[] = [];
  // The page's own Content-Security-Policy refusing something is reported by the engine as an event, in every engine.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(
        `${e.violatedDirective}: ${e.blockedURI || "inline"} at ${e.sourceFile || "?"}:${e.lineNumber}` +
          (e.sample ? ` "${e.sample}"` : "") +
          // For an inline attribute the event is fired at the element that carries it.
          (e.target instanceof Element ? ` on ${e.target.outerHTML.slice(0, 120)}` : ""),
      ),
    );
  });
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(origin);
  const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  return { requests, problems, violations };
}

const fileButtons = (page: Page) => page.locator("#files button");

test.describe("the web generator", () => {
  test("starts empty, asks for nothing from the network, and has no console errors", async ({ page }) => {
    const { requests, problems, violations } = await open(page);
    await expect(page.getByRole("heading", { name: "Deep link generator" })).toBeVisible();
    await expect(page.getByText("Add a domain and at least one app")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download ZIP" })).toBeDisabled();
    expect(requests.every((url) => url.startsWith(origin))).toBe(true);
    expect(await violations()).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("filling in the form produces the files, and the ZIP holds them under deeplinker-dist/", async ({
    page,
  }) => {
    const { requests, problems, violations } = await open(page);
    await page.getByLabel("Domains", { exact: true }).fill("example.com");
    await page.getByLabel("App ID").fill("K7ZP4W2Q9X.com.example.app");
    await page.getByLabel("App Store link").fill("https://apps.apple.com/app/id123456789");
    await page.getByLabel("Where it is hosted").selectOption("nginx");

    await expect(page.locator("#status")).toContainText("files for example.com, written for nginx");
    await expect(fileButtons(page).first()).toBeVisible();
    const names = await fileButtons(page).locator(".path").allTextContents();
    expect(names).toEqual(
      expect.arrayContaining([
        ".well-known/apple-app-site-association",
        "deeplinker.js",
        "nginx-deeplinker.conf",
        "README-DEPLOY.md",
      ]),
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download ZIP" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("deeplinker-example.com.zip");
    const path = await download.path();
    const entries = readZip(new Uint8Array(readFileSync(path)));
    expect(entries.map((e) => e.name)).toEqual(names.map((n) => `deeplinker-dist/${n}`));
    const aasa = JSON.parse(
      asText(entries.find((e) => e.name.endsWith("apple-app-site-association")) as never),
    );
    expect(aasa.applinks.details[0].appIDs).toEqual(["K7ZP4W2Q9X.com.example.app"]);

    expect(requests.every((url) => url.startsWith(origin) || url.startsWith("blob:"))).toBe(true);
    expect(await violations()).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("the example fills the form and the JSON, and selecting a file previews it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Fill in an example" }).click();
    await expect(page.getByLabel("Domains", { exact: true })).toHaveValue("example.com\nwww.example.com");
    await expect(page.getByLabel("Pages", { exact: true })).toHaveValue("/property/*\n/listing/*\n!/admin/*");

    await page.getByRole("tab", { name: "JSON" }).click();
    const json = JSON.parse(await page.locator("#json").inputValue());
    expect(json.apps.android.packageName).toBe("com.example.app");
    expect(json.web.routes).toEqual([{ from: "/property/:id", to: "/p/:id" }]);

    await fileButtons(page).filter({ hasText: "assetlinks.json" }).click();
    await expect(page.locator("#preview-title")).toHaveText(".well-known/assetlinks.json");
    await expect(page.locator("#preview")).toContainText("com.example.app");
    await expect(page.locator("#preview-where")).toContainText(
      "https://example.com/.well-known/assetlinks.json",
    );
  });

  test("editing the JSON updates the form, and the form keeps the options it has no field for", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Fill in an example" }).click();
    await page.getByRole("tab", { name: "JSON" }).click();
    const edited = JSON.parse(await page.locator("#json").inputValue());
    edited.domains = ["shop.example.org"];
    edited.outDir = "public/deeplinker";
    await page.locator("#json").fill(JSON.stringify(edited, null, 2));
    await page.getByRole("tab", { name: "Form" }).click();
    await expect(page.getByLabel("Domains", { exact: true })).toHaveValue("shop.example.org");

    await page.getByLabel("Web app address").fill("https://app.shop.example.org");
    await page.getByRole("tab", { name: "JSON" }).click();
    const after = JSON.parse(await page.locator("#json").inputValue());
    expect(after.outDir).toBe("public/deeplinker");
    expect(after.web.url).toBe("https://app.shop.example.org");
    expect(after.web.routes).toEqual([{ from: "/property/:id", to: "/p/:id" }]);
  });

  test("a mistake says which field and what a good value looks like, and nothing can be downloaded", async ({
    page,
  }) => {
    await open(page);
    await page.getByLabel("Domains", { exact: true }).fill("https://example.com/");
    const problem = page.locator("#problems .issues li").first();
    await expect(problem.locator("code")).toHaveText("domains[0]");
    await expect(problem).toContainText("URL");
    await expect(problem.locator(".example")).toContainText("example.com");
    await expect(page.getByRole("button", { name: "Download ZIP" })).toBeDisabled();
    await page.getByLabel("Domains", { exact: true }).fill("example.com");
    await expect(page.locator("#problems .issues")).toHaveCount(0);
  });

  test("a JSON typo is reported as one, and the form is not wiped", async ({ page }) => {
    await open(page);
    await page.getByLabel("Domains", { exact: true }).fill("example.com");
    await page.getByRole("tab", { name: "JSON" }).click();
    await page.locator("#json").fill('{ "domains": ');
    await expect(page.locator("#problems")).toContainText("syntax error");
    await expect(page.getByRole("button", { name: "Download ZIP" })).toBeDisabled();
    await page.getByRole("tab", { name: "Form" }).click();
    await expect(page.getByLabel("Domains", { exact: true })).toHaveValue("example.com");
  });

  test("the config can be downloaded as the file the command line reads", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Fill in an example" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download config" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("deeplinker.config.json");
    const config = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(config.domains).toEqual(["example.com", "www.example.com"]);
    expect(config.apps.ios.appIds).toEqual(["K7ZP4W2Q9X.com.example.app"]);
  });

  test("a pasted file is merged, and the preview shows both yours and ours", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Fill in an example" }).click();
    await page.getByLabel("Where it is hosted").selectOption("apache");
    await page.getByText("Merge with files you already have").click();
    await page.getByLabel(".htaccess").fill("RewriteEngine On\nRewriteRule ^old$ /new [R=301,L]\n");
    await fileButtons(page)
      .filter({ hasText: /^\.htaccess/ })
      .click();
    const preview = page.locator("#preview");
    await expect(preview).toContainText("# BEGIN deeplinker");
    await expect(preview).toContainText("RewriteRule ^old$ /new [R=301,L]");
  });

  test("the deferred options write the endpoint and its routing", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Fill in an example" }).click();
    await page.getByLabel("Remember where installs came from").check();
    await expect(fileButtons(page).filter({ hasText: "deferred/node/server.mjs" })).toBeVisible();
    await expect(page.locator("#status")).toContainText("files for example.com");
    await fileButtons(page).filter({ hasText: "nginx-deeplinker.conf" }).click();
    await expect(page.locator("#preview")).toContainText("location = /dl/click");
  });

  test("the tabs work from the keyboard", async ({ page }) => {
    await open(page);
    await page.getByRole("tab", { name: "Form" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#panel-json")).toBeVisible();
    await expect(page.locator("#panel-form")).toBeHidden();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
  });
});
