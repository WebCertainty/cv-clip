// CDP verification script — uses Node.js built-in WebSocket (v22+)
const http = require("http");

const EXT_ID = "fignfifoniblkonapihmkfakmlgkbkcf";
const PANEL_URL = `chrome-extension://${EXT_ID}/sidepanel/index.html`;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    }).on("error", reject);
  });
}

function cdpSession(wsUrl, commands, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = [];
    let cmdIndex = 0;
    let msgId = 0;
    let done = false;

    const finish = () => { if (!done) { done = true; ws.close(); resolve(results); } };
    const timer = setTimeout(finish, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: ++msgId, method: commands[0].method, params: commands[0].params || {} }));
    });

    ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      if (!msg.id) return; // event, not response
      results.push({ cmd: commands[cmdIndex].method, result: msg.result, error: msg.error });
      cmdIndex++;
      if (cmdIndex < commands.length) {
        ws.send(JSON.stringify({ id: ++msgId, method: commands[cmdIndex].method, params: commands[cmdIndex].params || {} }));
      } else {
        clearTimeout(timer);
        finish();
      }
    });

    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(e.message || "WebSocket error")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("=== Bridge health ===");
  const health = await get("http://127.0.0.1:43119/health").catch(e => ({ error: e.message }));
  console.log(JSON.stringify(health, null, 2));

  console.log("\n=== CDP targets ===");
  const targets = await get("http://127.0.0.1:9222/json/list");
  targets.forEach(t => console.log(`  [${t.type.padEnd(14)}] ${t.title.slice(0,60).padEnd(60)} ${t.url.slice(0,70)}`));

  const swTarget = targets.find(t => t.url && t.url.includes(EXT_ID) && t.type === "service_worker");
  console.log(`\nCV CLIP service worker: ${swTarget ? "FOUND — " + swTarget.url : "NOT FOUND"}`);

  const pageTarget = targets.find(t => t.type === "page" && !t.url.startsWith("chrome-extension://"));
  if (!pageTarget) { console.log("No browseable page target found — cannot navigate"); return; }

  console.log(`\n=== Navigating page to side panel URL ===`);
  console.log(`  Page: ${pageTarget.title} (${pageTarget.url})`);
  console.log(`  Destination: ${PANEL_URL}`);

  const navResult = await cdpSession(pageTarget.webSocketDebuggerUrl, [
    { method: "Page.navigate", params: { url: PANEL_URL } },
  ]);
  console.log("Navigate result:", JSON.stringify(navResult[0]?.result || navResult[0]?.error, null, 2));

  await sleep(3000);

  const targets2 = await get("http://127.0.0.1:9222/json/list");
  const panelTarget = targets2.find(t => t.url && t.url.includes(EXT_ID) && t.type === "page");
  console.log(`\nPanel page target: ${panelTarget ? "FOUND — " + panelTarget.url : "NOT FOUND (may have navigated the existing target)"}`);

  // Use whatever target now has the panel URL
  const evalTarget = panelTarget || targets2.find(t => t.type === "page");
  if (!evalTarget) { console.log("No eval target"); return; }

  console.log(`\n=== Evaluating panel DOM ===`);
  const evals = await cdpSession(evalTarget.webSocketDebuggerUrl, [
    { method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.URL", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.getElementById('statusText')?.textContent ?? 'NO STATUS'", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.body?.children?.length ?? -1", returnByValue: true } },
  ]);
  evals.forEach(r => {
    const val = r.result?.result?.value;
    const err = r.error || r.result?.exceptionDetails;
    console.log(`  ${r.cmd} => ${err ? "ERROR: " + JSON.stringify(err) : JSON.stringify(val)}`);
  });
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
