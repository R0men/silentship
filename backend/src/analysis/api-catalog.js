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

/** Walk declarations, calling visit(path, docComment) for every namespace, type and member. */
function walkDeclarations(statements, prefix, visit, inherited) {
  for (let node of statements) {
    let doc = commentText(node);
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      node = node.declaration;
      doc = doc || commentText(node);
    }
    const name = nameOf(node);
    if (!name) {
      if (node.type === "VariableDeclaration") {
        for (const d of node.declarations) if (d.id?.name) visit(`${prefix}${d.id.name}`, doc, inherited);
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
          if (n && !n.startsWith("_")) visit(`${path}.${n}`, commentText(m), own);
        }
        break;
      case "TSInterfaceDeclaration":
        for (const m of node.body.body) {
          const n = nameOf(m);
          if (n) visit(`${path}.${n}`, commentText(m), own);
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
  const ga = readTypes("@types/office-js");
  const preview = readTypes("@types/office-js-preview");

  const collect = (ast, isPreviewPackage) => {
    walkDeclarations(
      ast.program.body,
      "",
      (path, doc, inherited) => {
        const set = API_SET.exec(doc)?.[1]?.trim() ?? inherited?.apiSet ?? null;
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
  return { entries, versions: { ga: ga.version, preview: preview.version } };
}

let catalog;
/** Parsed once per process (~0.7 s for both packages). */
export function apiCatalog() {
  catalog ??= buildCatalog();
  return catalog;
}

/**
 * Status of a reflected path. Exact match first; otherwise the nearest documented ancestor decides
 * whether the member is preview (inside a preview type) or merely undocumented (inside a GA type).
 */
export function apiStatus(path, cat = apiCatalog()) {
  const exact = cat.entries.get(path);
  if (exact) return exact;
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = cat.entries.get(parts.slice(0, i).join("."));
    if (parent) return { status: parent.status === "preview" ? "preview" : "undocumented", apiSet: parent.apiSet };
  }
  return { status: "undocumented", apiSet: null };
}
