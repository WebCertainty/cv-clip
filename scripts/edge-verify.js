// Edge CDP verification — navigate to a page, wake CV CLIP SW, attempt sidePanel.open()
const http = require("http");
const EXT_ID = "fignfifoniblkonapihmkfakmlgkbkcf";

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    }).on("error", reject);
  });
}

function cdp(wsUrl, commands, ms = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = []; let idx = 0, id = 0, done = false;
    const fin = () => { if (!done) { done = true; try { ws.close(); } catch {} resolve(results); } };
    const t = setTimeout(fin, ms);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: ++id, method: commands[0].method, params: commands[0].params || {} })));
    ws.addEventListener("message", evt => {
      const msg = JSON.parse(evt.data);
      if (!msg.id) return;
      results.push({ cmd: commands[idx].method, result: msg.result, error: msg.error });
      idx++;
      if (idx < commands.length) ws.send(JSON.stringify({ id: ++id, method: commands[idx].method, params: commands[idx].params || {} }));
      else { clearTimeout(t); fin(); }
    });
    ws.addEventListener("error", e => { clearTimeout(t); reject(new Error(String(e.message))); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function listTargets() { return get("http://127.0.0.1:9222/json/list"); }

async function main() {
  let targets = await listTargets();
  const pageTarget = targets.find(t => t.type === "page");
  if (!pageTarget) { console.log("No page target"); return; }

  console.log("=== Navigating Edge to example.com to wake extension ===");
  await cdp(pageTarget.webSocketDebuggerUrl, [
    { method: "Page.navigate", params: { url: "https://example.com" } }
  ]);
  await sleep(4000);

  targets = await listTargets();
  console.log("\n=== All targets after navigation ===");
  targets.forEach(t => {
    const isCvClip = t.url && t.url.includes(EXT_ID);
    console.log(`  [${t.type.padEnd(14)}]${isCvClip ? " <<CV CLIP>>" : ""} ${t.title.slice(0,50).padEnd(50)} | ${t.url.slice(0,60)}`);
  });

  const swTarget = targets.find(t => t.url && t.url.includes(EXT_ID) && t.type === "service_worker");
  console.log(`\nCV CLIP SW: ${swTarget ? "FOUND ✅" : "NOT FOUND"}`);

  if (!swTarget) {
    // Try waking SW via extension messaging
    console.log("Trying to wake SW via chrome.runtime.sendMessage from page...");
    const pageT = targets.find(t => t.type === "page");
    if (pageT) {
      const wakeResult = await cdp(pageT.webSocketDebuggerUrl, [
        { method: "Runtime.evaluate", params: {
            expression: `new Promise(resolve => chrome.runtime.sendMessage("${EXT_ID}", { type: "cvclip:get-active-draft" }, r => resolve("response: " + JSON.stringify(r)))).catch(e => "error: " + e.message)`,
            returnByValue: true, awaitPromise: true, timeout: 5000
        }}
      ]);
      console.log("Wake via sendMessage:", JSON.stringify(wakeResult[0]?.result?.result?.value ?? wakeResult[0]?.error));
      await sleep(2000);

      targets = await listTargets();
      const sw2 = targets.find(t => t.url && t.url.includes(EXT_ID) && t.type === "service_worker");
      console.log(`CV CLIP SW after wake attempt: ${sw2 ? "FOUND ✅" : "still not found"}`);
      if (sw2) Object.assign(swTarget || {}, sw2);
    }
  }

  // Fresh lookup
  targets = await listTargets();
  const sw = targets.find(t => t.url && t.url.includes(EXT_ID) && t.type === "service_worker");

  if (sw) {
    console.log("\n=== Bridge fetch from CV CLIP SW ===");
    const bridgeRes = await cdp(sw.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: {
          expression: `fetch("http://127.0.0.1:43119/health").then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>"error: "+e.message)`,
          returnByValue: true, awaitPromise: true, timeout: 5000
      }}
    ]);
    console.log("Bridge from SW:", bridgeRes[0]?.result?.result?.value ?? JSON.stringify(bridgeRes[0]?.error));

    console.log("\n=== sidePanel.open() from SW (no gesture context) ===");
    const winRes = await cdp(targets.find(t=>t.type==="page").webSocketDebuggerUrl, [
      { method: "Browser.getWindowForTarget", params: {} }
    ]);
    const windowId = winRes[0]?.result?.windowId;
    console.log("Window ID:", windowId);
    if (windowId !== undefined) {
      const openRes = await cdp(sw.webSocketDebuggerUrl, [
        { method: "Runtime.evaluate", params: {
            expression: `chrome.sidePanel.open({ windowId: ${windowId} }).then(()=>"OPENED ✅").catch(e=>"error: "+e.message)`,
            returnByValue: true, awaitPromise: true, timeout: 5000
        }}
      ]);
      console.log("sidePanel.open():", openRes[0]?.result?.result?.value ?? JSON.stringify(openRes[0]?.error));
    }
  }

  console.log("\n=== Extension installed in Edge? Check IDs present ===");
  const cvClipTargets = (await listTargets()).filter(t => t.url && t.url.includes(EXT_ID));
  console.log(cvClipTargets.length > 0 ? `YES — ${cvClipTargets.length} CV CLIP target(s)` : "Extension not found in any target URL");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
