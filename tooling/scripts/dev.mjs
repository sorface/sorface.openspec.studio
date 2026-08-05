import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../openspec.frontend");
const children = [
  spawn(npmCommand, ["run", "dev:backend"], { stdio: "inherit", cwd: frontendRoot }),
  spawn(npmCommand, ["run", "dev:web"], { stdio: "inherit", cwd: frontendRoot }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await Promise.race(
  children.map((child) => new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 0)))),
);
stop();
process.exit(Number(exitCode));
