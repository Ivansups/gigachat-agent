import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Returns the problems found in a packed npm tarball.
 * @param {{ path: string, mode: number, type?: string }[]} entries files inside the tarball
 * @param {{ dependencies?: Record<string, string>, bin?: Record<string, string> }} manifest parsed package.json
 * @returns {string[]}
 */
export function checkPack(entries, manifest) {
  const problems = [];
  const paths = entries.map((e) => e.path);

  for (const { path, type = "-" } of entries) {
    if (type !== "-" && type !== "d") problems.push(`non-regular entry (${type}): ${path}`);
    if (/\s/.test(path)) problems.push(`whitespace in path: ${path}`);
  }

  for (const required of ["package/LICENSE", "package/README.md"]) {
    if (!paths.includes(required)) problems.push(`missing ${required}`);
  }
  if (!paths.some((p) => p.startsWith("package/dist/"))) problems.push("missing package/dist/");
  for (const p of paths.filter((p) => p.startsWith("package/src/"))) problems.push(`unexpected ${p}`);

  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (range.startsWith("workspace:")) problems.push(`workspace: dependency ${name}`);
  }

  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    const path = `package/${target.replace(/^\.\//, "")}`;
    const entry = entries.find((e) => e.path === path);
    if (!entry) problems.push(`bin ${name} target missing: ${path}`);
    else if ((entry.mode & 0o111) === 0) problems.push(`bin ${name} is not executable: ${path}`);
  }
  return problems;
}

/** Pairs exact names from `tar -tzf` with the type and mode columns of `tar -tvzf`. */
function listEntries(tarball) {
  const lines = (args) => execFileSync("tar", args, { encoding: "utf8" }).split("\n").filter(Boolean);
  const names = lines(["-tzf", tarball]);
  const details = lines(["-tvzf", tarball]);
  if (names.length !== details.length) throw new Error(`cannot list ${tarball} consistently`);
  const modeBits = { r: 4, w: 2, x: 1 };
  return details.map((line, index) => {
    let mode = 0;
    for (let i = 0; i < 9; i++) mode |= (modeBits[line[1 + i]] ?? 0) << (6 - 3 * Math.floor(i / 3));
    return { path: names[index], mode, type: line[0] };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = false;
  for (const tarball of process.argv.slice(2)) {
    const manifest = JSON.parse(execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }));
    const problems = checkPack(listEntries(tarball), manifest);
    for (const p of problems) console.error(`${tarball}: ${p}`);
    if (problems.length > 0) failed = true;
    else console.log(`${tarball}: ok`);
  }
  process.exit(failed ? 1 : 0);
}
