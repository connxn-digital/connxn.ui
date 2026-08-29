// Windows launcher for connxn.ui — the counterpart of "CLICK ME.command" on macOS.
// Picks the first free port from PORT (default 4173), starts server.mjs in this
// same process, then opens the default browser once the server answers.

import net from "node:net";
import { spawn } from "node:child_process";

const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT || 4173);

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function pickPort() {
  for (let port = START_PORT; port < START_PORT + 100; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free port between ${START_PORT} and ${START_PORT + 99}.`);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status < 500) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function openBrowser(url) {
  // "start" is a cmd builtin, so it needs cmd /c. The empty "" is the window title.
  spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

const port = await pickPort();
process.env.HOST = HOST;
process.env.PORT = String(port);

const url = `http://${HOST}:${port}`;
console.log(`Project: ${process.cwd()}`);
console.log(`Opening ${url}`);
console.log("");
console.log("Keep this window open while using connxn.ui.");
console.log("Close it or press Ctrl+C to stop the server.");
console.log("");

await import("./server.mjs");

if (await waitForServer(url)) {
  openBrowser(url);
} else {
  console.log("");
  console.log(`Server did not become ready. Last URL tried: ${url}`);
  console.log("Check the log above for details.");
}
