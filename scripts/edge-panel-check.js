// Check Edge CDP for CV CLIP page & SW, then try sidePanel.open()
const http = require("http");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    }).on("error", reject);
  });
}

function cdp(wsUrl, commands, ms = 10000) {
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

async function main() {
  const targets = await get("http://127.0.0.1:9222/json/list");

  console.log("=== All targets ===");
  targets.forEach(t => console.log(`  [${t.type.padEnd(14)}] ${t.title.padEnd(40)} | ${t.url.slice(0, 60)}`));

  const cvClipPage = targets.find(t => t.title === "CV CLIP" && t.type === "page");
  const swTarget = targets.find(t => t.type === "service_worker" && t.url && (t.url.includes("service-worker") || t.url.includes("service_worker")) && !t.url.includes("msn.com") && !t.url.includes("ndcpkim") && !t.url.includes("cdhoknd") && !t.url.includes("kkelica"));
  const edgePageTarget = targets.find(t => t.type === "page" && t.url && t.url.startsWith("http"));

  console.log(`\nCV CLIP page target: ${cvClipPage ? "FOUND (" + cvClipPage.url + ")" : "not found"}`);
  console.log(`CV CLIP SW target: ${swTarget ? "FOUND (" + swTarget.url + ")" : "not found"}`);

  if (cvClipPage) {
    console.log("\n=== Inspect CV CLIP page target ===");
    const evalRes = await cdp(cvClipPage.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: { expression: "document.title + ' @ ' + document.URL", returnByValue: true } },
      { method: "Runtime.evaluate", params: { expression: "document.getElementById('statusText')?.textContent ?? document.body?.innerText?.slice(0, 200) ?? 'EMPTY'", returnByValue: true } },
      { method: "Runtime.evaluate", params: { expression: "typeof chrome !== 'undefined' ? 'chrome OK' : 'no chrome'", returnByValue: true } },
      { method: "Runtime.evaluate", params: { expression: "typeof chrome.sidePanel !== 'undefined' ? 'sidePanel API present' : 'no sidePanel'", returnByValue: true } },
    ]);
    evalRes.forEach(r => console.log("  " + r.cmd, "=>", JSON.stringify(r.result?.result?.value ?? r.error)));
  }

  if (swTarget) {
    console.log("\n=== CV CLIP SW bridge check ===");
    const bridgeRes = await cdp(swTarget.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: {
          expression: `fetch("http://127.0.0.1:43119/health").then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>"error: "+e.message)`,
          returnByValue: true, awaitPromise: true, timeout: 5000
      }}
    ]);
    console.log("Bridge from SW:", bridgeRes[0]?.result?.result?.value ?? JSON.stringify(bridgeRes[0]?.error));

    // Try sidePanel.open()
    if (edgePageTarget) {
      const winRes = await cdp(edgePageTarget.webSocketDebuggerUrl, [
        { method: "Browser.getWindowForTarget", params: {} }
      ]);
      const windowId = winRes[0]?.result?.windowId;
      console.log("\nWindow ID:", windowId);

      if (windowId !== undefined) {
        console.log("Attempting chrome.sidePanel.open() from SW context...");
        const openRes = await cdp(swTarget.webSocketDebuggerUrl, [
          { method: "Runtime.evaluate", params: {
              expression: `chrome.sidePanel.open({ windowId: ${windowId} }).then(()=>"OPENED ✅").catch(e=>"error: "+e.message)`,
              returnByValue: true, awaitPromise: true, timeout: 5000
          }}
        ]);
        console.log("sidePanel.open():", openRes[0]?.result?.result?.value ?? JSON.stringify(openRes[0]?.error));
      }
    }
  }

  // Check if CV CLIP status text shows bridge connected
  if (cvClipPage) {
    await sleep(3000);
    console.log("\n=== CV CLIP status after 3s ===");
    const statusRes = await cdp(cvClipPage.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: { expression: "document.getElementById('statusText')?.textContent ?? 'no element'", returnByValue: true } },
    ]);
    console.log("Status:", statusRes[0]?.result?.result?.value);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
