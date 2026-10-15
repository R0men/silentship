const SKIP_KEYS = new Set(["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "extra"]);

/** Depth-first walk over a Babel AST; `parent` is the closest enclosing node. */
export function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  const n = node;
  const isNode = typeof n.type === "string";
  if (isNode) visit(n, parent);
  for (const key of Object.keys(n)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(n[key], visit, isNode ? n : parent);
  }
}
