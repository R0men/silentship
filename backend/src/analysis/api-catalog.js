import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "@babel/parser";

/**
 * What Microsoft documents about each API, from the official type definitions:
 *  - @types/office-js          generally available APIs, each with "[Api set: ExcelApi 1.4]";
 *  - @types/office-js-preview  everything above plus preview APIs, marked "@beta" and
 *                               "[Api set: ExcelApi BETA (PREVIEW ONLY)]".
 * Preview APIs may change or disappear without notice (Microsoft says so), so changes to them must not
 * be reported like changes to GA APIs. Paths match the reflected surface: "Excel.Range.getCell".
 *
 * Status per path: "ga" | "preview" | "undocumented" (reflected, but in neither package — internal).
 */

const require = createRequire(import.meta.url);
const API_SET = /\[Api set:\s*([^\]]+)\]/;
// Common APIs (Office.*) name theirs in a link instead: "**Requirement set**: {@link https://… | RibbonApi 1.1}".
const REQUIREMENT_SET = /\*\*Requirement sets?\*\*:\s*\{@link [^|}]*\|\s*([^}]+?)\s*\}/;

/** "ExcelApi 1.4", "RibbonApi 1.1"; null when the comment names none (or says "Not in a set"). */
function apiSetOf(doc) {
  const set = (API_SET.exec(doc) ?? REQUIREMENT_SET.exec(doc))?.[1]?.trim();
  return set && !/^not in a set$/i.test(set) ? set : null;
}

function commentText(node) {
  return (node.leadingComments ?? []).map((c) => c.value).join("\n");
}

function nameOf(node) {
  const id = node.id ?? node.key;
  if (!id) return null;
  if (id.type === "Identifier") return id.name;
  if (id.type === "StringLiteral") return id.value;
  return null;
}

/** "Ribbon" or "Office.UI" from a plain type reference (`ribbon: Ribbon`); null for unions, arrays, functions. */
function refName(annotation) {
  const t = annotation?.typeAnnotation;
  if (t?.type !== "TSTypeReference") return null;
  const name = (n) => (n.type === "Identifier" ? n.name : n.type === "TSQualifiedName" ? `${name(n.left)}.${n.right.name}` : null);
  return name(t.typeName);
}

/**
 * Walk declarations, calling visit(path, docComment, inherited, ref) for every namespace, type and member.
 * `ref` is the type a variable or property points to, with the namespace to resolve it in
 * (`Office.ribbon` → { name: "Ribbon", ns: "Office" }), so runtime paths can be mapped to typed ones.
 */
function walkDeclarations(statements, prefix, visit, inherited) {
  const ns = prefix.replace(/.$/, "");
  const refOf = (m) => {
    const name = refName(m.id?.typeAnnotation ?? m.typeAnnotation);
    return name ? { name, ns } : null;
  };
  for (let node of statements) {
    let doc = commentText(node);
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      node = node.declaration;
      doc = doc || commentText(node);
    }
    const name = nameOf(node);
    if (!name) {
      if (node.type === "VariableDeclaration") {
        for (const d of node.declarations) if (d.id?.name) visit(`${prefix}${d.id.name}`, doc, inherited, refOf(d));
      }
      continue;
    }
    const path = `${prefix}${name}`;
    // Interfaces/ (load options, data shapes) never exist at runtime.
    if (name === "Interfaces") continue;
    const own = visit(path, doc, inherited);
    switch (node.type) {
      case "TSModuleDeclaration": {
        let body = node.body;
        // `namespace A.B {}` nests module declarations.
        let p = path;
        while (body?.type === "TSModuleDeclaration") {
          p = `${p}.${nameOf(body)}`;
          body = body.body;
        }
        if (body?.body) walkDeclarations(body.body, `${p}.`, visit, own);
        break;
      }
      case "ClassDeclaration":
        for (const m of node.body.body) {
          const n = nameOf(m);
          if (n && !n.startsWith("_")) visit(`${path}.${n}`, commentText(m), own, refOf(m));
        }
        break;
      case "TSInterfaceDeclaration":
        for (const m of node.body.body) {
          const n = nameOf(m);
          if (n) visit(`${path}.${n}`, commentText(m), own, refOf(m));
        }
        break;
      case "TSEnumDeclaration":
        for (const m of node.members ?? node.body?.members ?? []) {
          const n = nameOf(m);
          if (n) visit(`${path}.${n}`, commentText(m), own);
        }
        break;
      default:
    }
  }
}

function readTypes(pkg) {
  const file = require.resolve(`${pkg}/index.d.ts`);
  const version = JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), "utf8")).version;
  const ast = parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: [["typescript", { dts: true }]],
    errorRecovery: true,
  });
  return { ast, version };
}

/** Build path → { status, apiSet } from both packages. */
export function buildCatalog() {
  const entries = new Map();
  // path → { name, ns } of the type it points to: `Office.context` → Context in Office.
  const refs = new Map();
  const ga = readTypes("@types/office-js");
  const preview = readTypes("@types/office-js-preview");

  const collect = (ast, isPreviewPackage) => {
    walkDeclarations(
      ast.program.body,
      "",
      (path, doc, inherited, ref) => {
        if (ref && !refs.has(path)) refs.set(path, ref);
        const set = apiSetOf(doc) ?? inherited?.apiSet ?? null;
        const beta = /@beta\b/.test(doc) || /PREVIEW ONLY/i.test(set ?? "") || Boolean(inherited?.beta);
        const info = { apiSet: set, beta };
        if (!isPreviewPackage) {
          entries.set(path, { status: beta ? "preview" : "ga", apiSet: set });
        } else if (!entries.has(path)) {
          // Only in the preview package: preview, whatever the comment says.
          entries.set(path, { status: "preview", apiSet: set });
        }
        return info;
      },
      null,
    );
  };
  collect(ga.ast, false);
  collect(preview.ast, true);
  return { entries, refs, versions: { ga: ga.version, preview: preview.version } };
}

let catalog;
/** Parsed once per process (~0.7 s for both packages). */
export function apiCatalog() {
  catalog ??= buildCatalog();
  return catalog;
}

/** The declared type a path points to (`Office.ribbon` → "Office.Ribbon"), resolved like TypeScript does. */
function typeOf(path, cat) {
  const ref = cat.refs?.get(path);
  if (!ref) return null;
  const scopes = ref.ns ? ref.ns.split(".") : [];
  for (let i = scopes.length; i >= 0; i--) {
    const candidate = [...scopes.slice(0, i), ref.name].join(".");
    if (cat.entries.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The typed path of a runtime one. Office.js exposes some APIs through objects (`Office.context.ui`,
 * `Office.ribbon`) whose members the types declare on an interface (`Office.UI`, `Office.Ribbon`), so
 * `Office.context.ui.displayDialogAsync` is documented as `Office.UI.displayDialogAsync`.
 */
export function typedPath(path, cat = apiCatalog()) {
  const parts = path.split(".");
  let cur = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const next = `${cur}.${parts[i]}`;
    cur = i < parts.length - 1 ? (typeOf(next, cat) ?? next) : next;
  }
  return cur;
}

/**
 * Status of a reflected path. Exact match first, then the same API reached through an object (`typedPath`); otherwise the nearest documented ancestor decides
 * whether the member is preview (inside a preview type) or merely undocumented (inside a GA type).
 */
export function apiStatus(runtimePath, cat = apiCatalog()) {
  const direct = cat.entries.get(runtimePath);
  if (direct) return direct;
  const path = typedPath(runtimePath, cat);
  const exact = cat.entries.get(path);
  if (exact) return exact;
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = cat.entries.get(parts.slice(0, i).join("."));
    if (parent) return { status: parent.status === "preview" ? "preview" : "undocumented", apiSet: parent.apiSet };
  }
  return { status: "undocumented", apiSet: null };
}

// Microsoft Learn folders per root namespace; Outlook's enums live under Office but are documented apart.
const LEARN_FOLDER = {
  Excel: "excel",
  Word: "word",
  PowerPoint: "powerpoint",
  OneNote: "onenote",
  Visio: "visio",
  Office: "office",
  OfficeExtension: "office",
};
const PREVIEW_VIEW = {
  excel: "excel-js-preview",
  word: "word-js-preview",
  powerpoint: "powerpoint-js-preview",
  office: "common-js-preview",
  outlook: "outlook-js-preview",
};

/**
 * The Microsoft Learn page of a documented type (`.../javascript/api/excel/excel.range`), or null: not in
 * either package, or not a type page (a function or an object such as `Office.context.ui` has none of
 * its own). Preview types get the preview view.
 */
export function learnUrl(type, cat = apiCatalog()) {
  const info = cat.entries.get(type);
  const segs = type.split(".");
  if (!info || segs.length < 2 || !segs.slice(1).every((s) => /^[A-Z]/.test(s))) return null;
  const folder = type.startsWith("Office.MailboxEnums.") ? "outlook" : LEARN_FOLDER[segs[0]];
  if (!folder) return null;
  const view = info.status === "preview" && PREVIEW_VIEW[folder] ? `?view=${PREVIEW_VIEW[folder]}` : "";
  return `https://learn.microsoft.com/en-us/javascript/api/${folder}/${type.toLowerCase()}${view}`;
}
