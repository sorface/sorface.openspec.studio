import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCommand, ["run", "dev:backend"], { stdio: "inherit" }),
  spawn(npmCommand, ["run", "dev:web"], { stdio: "inherit" }),
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
