import { format } from "prettier";

/** Pretty-prints minified JS so git diffs of the archive are line-based and readable. */
export async function formatJs(source) {
  try {
    return await format(source, { parser: "babel", printWidth: 120 });
  } catch {
    // A file prettier cannot parse is still archived raw; only the readable copy is skipped.
    return null;
  }
}
