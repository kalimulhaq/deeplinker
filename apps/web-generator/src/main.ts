import "./setup";
import { HOST_LABEL } from "@deeplinker/generator";
import type { ExistingFiles } from "@deeplinker/generator";
import { buildBundle, zipBundle, type Bundle } from "./bundle";
import { EXAMPLE } from "./example";
import { GROUPS, applyValues, toJsonText, valuesFromConfig, type Field, type Values } from "./form";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from the page`);
  return node as T;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

const form = byId<HTMLFormElement>("form");
const jsonBox = byId<HTMLTextAreaElement>("json");
const status = byId("status");
const empty = byId("empty");
const problems = byId("problems");
const result = byId("result");
const fileList = byId<HTMLUListElement>("files");
const previewTitle = byId("preview-title");
const previewWhere = byId("preview-where");
const preview = byId("preview");
const notes = byId<HTMLDetailsElement>("notes");
const zipButton = byId<HTMLButtonElement>("download-zip");
const configButton = byId<HTMLButtonElement>("download-config");

// ---------------------------------------------------------------- the form

function controlFor(field: Field): HTMLElement {
  const id = `f-${field.path.replace(/\./g, "-")}`;
  const hintId = `${id}-hint`;
  const base: Record<string, string> = { id, "data-path": field.path };
  if (field.hint) base["aria-describedby"] = hintId;
  if (field.kind === "lines")
    return el("textarea", { ...base, rows: "3", spellcheck: "false", placeholder: field.placeholder ?? "" });
  if (field.kind === "select")
    return el("select", base, ...(field.options ?? []).map((o) => el("option", { value: o.value }, o.label)));
  if (field.kind === "checkbox") return el("input", { ...base, type: "checkbox" });
  return el("input", {
    ...base,
    type: "text",
    spellcheck: "false",
    autocapitalize: "off",
    placeholder: field.placeholder ?? "",
  });
}

function renderForm(): void {
  for (const group of GROUPS) {
    const set = el("fieldset", {}, el("legend", {}, group.title));
    if (group.intro) set.append(el("p", { class: "intro" }, group.intro));
    for (const field of group.fields) {
      const control = controlFor(field);
      const hint = field.hint ? el("p", { class: "hint", id: `${control.id}-hint` }, field.hint) : null;
      if (field.kind === "checkbox") {
        set.append(
          el(
            "div",
            { class: "field check" },
            el("label", { for: control.id }, control, field.label),
            ...(hint ? [hint] : []),
          ),
        );
      } else {
        set.append(
          el(
            "div",
            { class: "field" },
            el("label", { for: control.id }, field.label),
            control,
            ...(hint ? [hint] : []),
          ),
        );
      }
    }
    form.append(set);
  }
}

const controls = () => [...form.querySelectorAll<HTMLElement>("[data-path]")];

function readForm(): Values {
  const values: Values = {};
  for (const node of controls()) {
    const path = node.dataset.path as string;
    values[path] =
      node instanceof HTMLInputElement && node.type === "checkbox"
        ? node.checked
        : (node as HTMLInputElement).value;
  }
  return values;
}

function writeForm(values: Values): void {
  for (const node of controls()) {
    const value = values[node.dataset.path as string];
    if (node instanceof HTMLInputElement && node.type === "checkbox") node.checked = value === true;
    else (node as HTMLInputElement).value = typeof value === "string" ? value : "";
  }
}

function existingFiles(): ExistingFiles {
  const files: ExistingFiles = {};
  for (const box of document.querySelectorAll<HTMLTextAreaElement>("[data-existing]")) {
    files[box.dataset.existing as keyof ExistingFiles] = box.value;
  }
  return files;
}

// ---------------------------------------------------------------- the output

let lastBundle: Bundle | null = null;
let selected = "";
/** The last config that parsed as an object, so typing in the form while the JSON tab holds a typo does not discard it. */
let lastConfig: Obj = {};

function show(parts: { status?: string; empty?: boolean; problems?: boolean; result?: boolean }): void {
  status.textContent = parts.status ?? "";
  empty.hidden = !parts.empty;
  problems.hidden = !parts.problems;
  result.hidden = !parts.result;
}

function showFile(bundle: Extract<Bundle, { ok: true }>, path: string): void {
  const file = bundle.files.find((f) => f.path === path) ?? bundle.files[0];
  if (!file) return;
  selected = file.path;
  for (const button of fileList.querySelectorAll("button")) {
    if (button.dataset.path === selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  previewTitle.textContent = file.path;
  previewWhere.textContent = `${file.description}. Goes to: ${(bundle.destinations[file.path] ?? file.path).replace(/`/g, "")}`;
  preview.textContent = file.content;
}

function renderBundle(bundle: Extract<Bundle, { ok: true }>): void {
  const count = bundle.files.length;
  show({
    status: `${count} files for ${bundle.domains.join(", ")}, written for ${HOST_LABEL[bundle.host.id]}. Config ${bundle.hash}.`,
    result: true,
  });

  fileList.replaceChildren(
    ...bundle.files.map((file) => {
      const slash = file.path.lastIndexOf("/") + 1;
      const button = el(
        "button",
        { type: "button", "data-path": file.path },
        el(
          "span",
          { class: "path" },
          el("span", { class: "dir" }, file.path.slice(0, slash)),
          file.path.slice(slash),
        ),
        el("span", { class: "what" }, file.description),
      );
      button.addEventListener("click", () => showFile(bundle, file.path));
      return el("li", {}, button);
    }),
  );
  showFile(bundle, selected);

  problems.replaceChildren();
  if (bundle.warnings.length) {
    problems.append(
      el("h3", {}, "Check these"),
      el("ul", { class: "warnings" }, ...bundle.warnings.map((w) => el("li", {}, w))),
    );
  }
  problems.hidden = bundle.warnings.length === 0;

  const list = notes.querySelector("ul") as HTMLUListElement;
  list.replaceChildren(...bundle.notes.map((n) => el("li", {}, n)));
  notes.hidden = bundle.notes.length === 0;
}

function renderProblems(bundle: Exclude<Bundle, { ok: true }>): void {
  problems.replaceChildren();
  if (bundle.kind === "json") {
    problems.append(
      el("h3", {}, "The JSON tab has a syntax error"),
      el("p", { class: "problem" }, bundle.message),
    );
  } else {
    problems.append(
      el("h3", {}, "Fix these first"),
      el(
        "ul",
        { class: "issues" },
        ...bundle.issues.map((issue) =>
          el(
            "li",
            {},
            el("code", {}, issue.path),
            ` ${issue.message}`,
            ...(issue.example ? [el("span", { class: "example" }, ` For example: ${issue.example}`)] : []),
          ),
        ),
      ),
    );
  }
  show({ status: "Nothing to download yet.", problems: true });
}

function refresh(): void {
  const text = jsonBox.value;
  let blank = text.trim() === "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObj(parsed)) {
      blank = Object.keys(parsed).length === 0;
      lastConfig = parsed;
    }
  } catch {
    /* reported below */
  }

  configButton.disabled = false;
  if (blank) {
    lastBundle = null;
    configButton.disabled = true;
    show({ empty: true });
  } else {
    lastBundle = buildBundle(text, existingFiles());
    if (lastBundle.ok) renderBundle(lastBundle);
    else renderProblems(lastBundle);
  }
  zipButton.disabled = !lastBundle?.ok;
  if (lastBundle && !lastBundle.ok && lastBundle.kind === "json") configButton.disabled = true;
}

function setConfig(config: Obj): void {
  lastConfig = config;
  jsonBox.value = toJsonText(config);
  writeForm(valuesFromConfig(config));
  refresh();
}

// ---------------------------------------------------------------- events

form.addEventListener("input", () => {
  lastConfig = applyValues(lastConfig, readForm());
  jsonBox.value = toJsonText(lastConfig);
  refresh();
});

jsonBox.addEventListener("input", () => {
  try {
    const parsed: unknown = JSON.parse(jsonBox.value);
    if (isObj(parsed)) writeForm(valuesFromConfig(parsed));
  } catch {
    /* the form keeps its values until the JSON parses again */
  }
  refresh();
});

for (const box of document.querySelectorAll<HTMLTextAreaElement>("[data-existing]")) {
  box.addEventListener("input", refresh);
}

byId("load-example").addEventListener("click", () => setConfig(structuredClone(EXAMPLE)));

const tabs = [byId("tab-form"), byId("tab-json")];
const panels = [byId("panel-form"), byId("panel-json")];
function selectTab(index: number, focus = false): void {
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    (panels[i] as HTMLElement).hidden = i !== index;
  });
  if (focus) (tabs[index] as HTMLElement).focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(i));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab((i + 1) % tabs.length, true);
    }
  });
});

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

zipButton.addEventListener("click", () => {
  if (lastBundle?.ok)
    download(`deeplinker-${lastBundle.domains[0]}.zip`, zipBundle(lastBundle), "application/zip");
});
configButton.addEventListener("click", () =>
  download("deeplinker.config.json", jsonBox.value, "application/json"),
);

renderForm();
setConfig({});
