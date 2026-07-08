#!/usr/bin/env node

const { execFileSync, spawn } = require("child_process");
const http = require("http");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const bridgeScript = path.join(repoRoot, "bridge", "server.js");
const host = process.env.CV_CLIP_HOST || "127.0.0.1";
const port = Number(process.env.CV_CLIP_PORT || 43119);
const command = process.argv[2] || "status";

function getListeningPids() {
  if (process.platform !== "win32") {
    throw new Error("Bridge control scripts are currently Windows-only.");
  }

  const output = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      [
        `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
        "$connections | Select-Object -ExpandProperty OwningProcess -Unique"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  return output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter(Boolean);
}

function requestHealth() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: "/health",
        timeout: 750
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              ok: response.statusCode === 200,
              statusCode: response.statusCode,
              payload: JSON.parse(body)
            });
          } catch {
            resolve({ ok: false, statusCode: response.statusCode });
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false });
    });
    request.on("error", () => resolve({ ok: false }));
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const health = await requestHealth();
    if (health.ok) {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { ok: false };
}

async function status() {
  const pids = getListeningPids();
  const health = await requestHealth();

  if (!pids.length) {
    console.log(`CV CLIP bridge is stopped on ${host}:${port}.`);
    process.exitCode = 1;
    return;
  }

  if (!health.ok) {
    console.log(
      `Port ${port} is in use by PID(s) ${pids.join(", ")}, but /health did not respond.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`CV CLIP bridge is running on http://${host}:${port}`);
  console.log(`PID(s): ${pids.join(", ")}`);
  console.log(`Notes root: ${health.payload.notesRoot}`);
  console.log(`Default folder: ${health.payload.defaultFolder}`);
}

async function start() {
  const existing = getListeningPids();
  if (existing.length) {
    console.log(
      `CV CLIP bridge already appears to be running on ${host}:${port} (PID ${existing.join(", ")}).`
    );
    return;
  }

  const child = spawn(process.execPath, [bridgeScript], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      CV_CLIP_PORT: String(port)
    },
    stdio: "ignore"
  });
  child.unref();

  const health = await waitForHealth();
  if (!health.ok) {
    throw new Error("Bridge process was started, but /health did not become available.");
  }

  console.log(`CV CLIP bridge started on http://${host}:${port}`);
  console.log(`PID: ${child.pid}`);
  console.log(`Notes root: ${health.payload.notesRoot}`);
}

function stop() {
  const pids = getListeningPids();
  if (!pids.length) {
    console.log(`CV CLIP bridge is already stopped on ${host}:${port}.`);
    return;
  }

  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Stop-Process -Id ${pids.join(",")} -Force`
    ],
    { stdio: "ignore" }
  );

  console.log(`Stopped CV CLIP bridge PID(s): ${pids.join(", ")}`);
}

async function restart() {
  stop();
  await start();
}

async function main() {
  if (command === "status") {
    await status();
    return;
  }
  if (command === "start") {
    await start();
    return;
  }
  if (command === "stop") {
    stop();
    return;
  }
  if (command === "restart") {
    await restart();
    return;
  }

  console.error("Usage: node scripts/bridge-control.js <status|start|stop|restart>");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
