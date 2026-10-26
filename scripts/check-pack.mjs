import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Returns the problems found in a packed npm tarball.
 * @param {{ path: string, mode: number }[]} entries files inside the tarball
 * @param {{ dependencies?: Record<string, string>, bin?: Record<string, string> }} manifest parsed package.json
 * @returns {string[]}
 */
export function checkPack(entries, manifest) {
  const problems = [];
  const paths = entries.map((e) => e.path);

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

/** Parses `tar -tvzf` lines: "-rwxr-xr-x  0 0 0 123 Jan 1 1985 package/x". */
function listEntries(tarball) {
  const modeBits = { r: 4, w: 2, x: 1 };
  return execFileSync("tar", ["-tvzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const perms = line.slice(1, 10);
      let mode = 0;
      for (let i = 0; i < 9; i++) if (perms[i] !== "-") mode |= modeBits[perms[i]] << (6 - 3 * Math.floor(i / 3));
      return { path: line.split(/\s+/).at(-1), mode };
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
