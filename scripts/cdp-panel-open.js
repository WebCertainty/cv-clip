// CDP: test side panel page load via createTarget, and trigger sidePanel.open() from SW context
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

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = new URL(url);
    const req = http.request({ hostname: opts.hostname, port: opts.port, path: opts.pathname, method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (res) => {
      let b = ""; res.on("data", d => b += d); res.on("end", () => { try { resolve(JSON.parse(b)); } catch(e) { resolve(b); } });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

function cdpOnce(wsUrl, commands, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = [];
    let idx = 0, msgId = 0, done = false;

    const finish = () => { if (!done) { done = true; try { ws.close(); } catch(_){} resolve(results); } };
    const timer = setTimeout(finish, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: ++msgId, method: commands[0].method, params: commands[0].params || {} }));
    });
    ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      if (!msg.id) return;
      results.push({ cmd: commands[idx].method, result: msg.result, error: msg.error });
      idx++;
      if (idx < commands.length) {
        ws.send(JSON.stringify({ id: ++msgId, method: commands[idx].method, params: commands[idx].params || {} }));
      } else { clearTimeout(timer); finish(); }
    });
    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(String(e.message || e))); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await get("http://127.0.0.1:9222/json/list");
  const swTarget = targets.find(t => t.url && t.url.includes(EXT_ID) && t.type === "service_worker");
  const pageTarget = targets.find(t => t.type === "page");

  console.log(`SW target: ${swTarget ? swTarget.url : "NOT FOUND"}`);
  console.log(`Page target: ${pageTarget ? pageTarget.url : "NOT FOUND"}`);

  // --- Test 1: createTarget at extension panel URL ---
  console.log("\n=== Test 1: Target.createTarget at panel URL ===");
  const createResult = await cdpOnce(pageTarget.webSocketDebuggerUrl, [
    { method: "Target.createTarget", params: { url: PANEL_URL } }
  ]);
  console.log("createTarget result:", JSON.stringify(createResult[0]?.result || createResult[0]?.error, null, 2));

  await sleep(2000);

  const targets2 = await get("http://127.0.0.1:9222/json/list");
  const newPanel = targets2.find(t => t.url && t.url.includes(EXT_ID) && t.type === "page");
  console.log("Panel page in targets:", newPanel ? `YES — ${newPanel.url}` : "NO");

  if (newPanel) {
    const evalResult = await cdpOnce(newPanel.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: { expression: "document.title + ' @ ' + document.URL", returnByValue: true } },
      { method: "Runtime.evaluate", params: { expression: "document.getElementById('statusText')?.textContent ?? 'NO STATUS'", returnByValue: true } },
    ]);
    evalResult.forEach(r => console.log("  eval:", r.cmd, "=>", JSON.stringify(r.result?.result?.value ?? r.error)));
  }

  // --- Test 2: sidePanel.open() from SW context ---
  if (swTarget) {
    console.log("\n=== Test 2: chrome.sidePanel.open() from SW context ===");
    // Get windowId from browser
    const windowRes = await cdpOnce(pageTarget.webSocketDebuggerUrl, [
      { method: "Browser.getWindowForTarget", params: {} }
    ]);
    const windowId = windowRes[0]?.result?.windowId;
    console.log("Window ID:", windowId);

    if (windowId !== undefined) {
      const swOpen = await cdpOnce(swTarget.webSocketDebuggerUrl, [
        { method: "Runtime.evaluate", params: {
            expression: `chrome.sidePanel.open({ windowId: ${windowId} }).then(() => "opened").catch(e => "error: " + e.message)`,
            returnByValue: true, awaitPromise: true
        }}
      ]);
      console.log("sidePanel.open() result:", JSON.stringify(swOpen[0]?.result?.result?.value ?? swOpen[0]?.error));
    }
  }

  // --- Test 3: check SW bridge health call ---
  if (swTarget) {
    console.log("\n=== Test 3: bridge fetch from SW context ===");
    const bridgeCheck = await cdpOnce(swTarget.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: {
          expression: `fetch("http://127.0.0.1:43119/health").then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>"error: "+e.message)`,
          returnByValue: true, awaitPromise: true
      }}
    ]);
    console.log("Bridge from SW:", bridgeCheck[0]?.result?.result?.value ?? bridgeCheck[0]?.error);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
