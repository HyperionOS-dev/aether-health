// Node has no bundler, so the two things vite does for free have to happen here: the "@/..."
// alias from vite.config.js, and extensionless relative imports such as "./tables".
//
// Loaded with `node --import ./src/lib/importers/gadgetbridge/node-alias-hooks.mjs`, which
// registers itself on the main thread before the test files are resolved. Registering from
// the same file is safe: registerHooks runs in-process, unlike register()'s worker thread,
// which would re-evaluate this file and register itself again.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTENSIONS = [".ts", ".js", ".mjs", ".jsx"];

function withExtension(path) {
  if (existsSync(path)) return path;
  for (const extension of EXTENSIONS) {
    if (existsSync(path + extension)) return path + extension;
  }
  return path;
}

// The directory a specifier was written in. For the entry module node hands over the working
// directory as a URL that already ends in a slash, and dirname() of that would step one level too
// far up, so the parent is derived from the path only when it names a file.
function parentDirectory(parentURL) {
  if (!parentURL) return process.cwd();
  const path = fileURLToPath(parentURL);
  return parentURL.endsWith("/") ? path : dirname(path);
}

registerHooks({
  // Vite resolves "@/" and extensionless relative imports as a matter of course; node does not.
  // Rather than reimplementing node's resolution, every specifier goes through it first and only
  // the ones it cannot find are retried with those two conveniences applied — which is also what
  // keeps this hook from changing how anything else resolves.
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(withExtension(resolve(SRC, specifier.slice(2)))).href, context);
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return nextResolve(pathToFileURL(withExtension(resolve(parentDirectory(context.parentURL), specifier))).href, context);
    }
    throw Object.assign(new Error(`Cannot find module '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });
  },
});