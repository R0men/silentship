import { parseExpression } from "@babel/parser";

import { sha256 } from "../crawler/fetcher.js";
import { walk } from "../util/ast.js";

/**
 * Is this Identifier a property name (kept) rather than a variable reference (renamed by minifiers)?
 */
function isPropertyName(node, parent) {
  if (!parent) return false;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.property === node && !parent.computed;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassMethod":
    case "ClassProperty":
      return parent.key === node && !parent.computed;
    default:
      return false;
  }
}

/** Candidates for re-parsing Function.prototype.toString() output. */
function wrappers(src) {
  // "function(e){..}", "class X{..}", "(e)=>.." parse as expressions;
  // method/accessor shorthand ("foo(e){..}", "get x(){..}") only inside an object literal.
  return [`(${src})`, `({${src}})`];
}

/**
 * Hash of a function's source that is stable under minifier identifier renaming:
 * every variable identifier becomes `$`, property names, literals and structure are kept,
 * whitespace is dropped.
 */
export function normalizedSourceHash(src) {
  for (const code of wrappers(src)) {
    let ast;
    try {
      ast = parseExpression(code, { errorRecovery: false });
    } catch {
      continue;
    }
    const replacements = [];
    walk(ast, (node, parent) => {
      if (node.type === "Identifier" && !isPropertyName(node, parent) && node.start != null && node.end != null) {
        replacements.push([node.start, node.end]);
      }
    });
    replacements.sort((a, b) => a[0] - b[0]);
    let out = "";
    let pos = 0;
    for (const [start, end] of replacements) {
      if (start < pos) continue; // shorthand properties report the same identifier twice
      out += code.slice(pos, start) + "$";
      pos = end;
    }
    out += code.slice(pos);
    return sha256(out.replace(/\s+/g, ""));
  }
  // Native code or unparsable: fall back to the raw text.
  return sha256(src.replace(/\s+/g, ""));
}
