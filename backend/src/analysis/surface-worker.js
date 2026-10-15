/**
 * Child-process entry: executes CDN scripts in node:vm and prints the reflected surface as JSON.
 * Runs out-of-process so a hanging or memory-hungry script cannot take down the monitor.
 *
 * argv: <file>                       reflect a single script (the loader)
 *       --host <loader> <host-file>  reflect a host file executed after the loader
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractHostSurface, extractSurface } from "./surface.js";

const read = (file) => ({ filename: path.basename(file), source: readFileSync(file, "utf8") });

const args = process.argv.slice(2);
const result = args[0] === "--host" ? extractHostSurface(read(args[1]), read(args[2])) : extractSurface(args.map(read));
process.stdout.write(JSON.stringify(result), () => process.exit(0));
