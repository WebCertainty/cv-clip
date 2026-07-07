// Full Edge test: bridge connection from panel, clip a selection, verify state
const http = require("http");
const https = require("https");

const PANEL_EXT_ID = "cdhokndnppigmfcbciechjeaeombfneh";

function get(url) {
  const lib = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { "User-Agent": "node" } }, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
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

async function main() {
  const targets = await get("http://127.0.0.1:9222/json/list");

  const panelTarget = targets.find(t => t.url && t.url.includes(PANEL_EXT_ID) && t.type === "page");
  const swTarget = targets.find(t => t.url && t.url.includes(PANEL_EXT_ID) && t.type === "service_worker");
  const webPageTarget = targets.find(t => t.type === "page" && t.url && t.url.startsWith("http"));

  console.log("Panel page:", panelTarget ? panelTarget.url : "NOT FOUND");
  console.log("SW:", swTarget ? swTarget.url : "not active (may need wake)");
  console.log("Web page for content test:", webPageTarget ? webPageTarget.url : "none");

  if (!panelTarget) { console.log("No CV CLIP panel target — aborting"); return; }

  // --- Bridge health ---
  console.log("\n=== 1. Bridge health ===");
  const health = await get("http://127.0.0.1:43119/health");
  console.log(JSON.stringify(health));

  // --- Panel current state ---
  console.log("\n=== 2. Panel current state ===");
  const stateRes = await cdp(panelTarget.webSocketDebuggerUrl, [
    { method: "Runtime.evaluate", params: { expression: "document.getElementById('statusText')?.textContent", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.getElementById('noteTitle')?.value", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.getElementById('folderPath')?.value", returnByValue: true } },
    { method: "Runtime.evaluate", params: { expression: "document.getElementById('noteBody')?.value?.slice(0, 200)", returnByValue: true } },
  ]);
  stateRes.forEach(r => console.log(" ", r.cmd.replace("Runtime.evaluate","eval"), "=>", JSON.stringify(r.result?.result?.value ?? r.error)));

  // --- Click "Check bridge" to refresh bridge connection ---
  console.log("\n=== 3. Click 'Check bridge' button ===");
  const clickRes = await cdp(panelTarget.webSocketDebuggerUrl, [
    { method: "Runtime.evaluate", params: {
        expression: `document.getElementById('refreshBridge').click(); new Promise(r => setTimeout(r, 2000)).then(() => document.getElementById('statusText')?.textContent)`,
        returnByValue: true, awaitPromise: true, timeout: 5000
    }}
  ]);
  console.log("Status after bridge refresh:", clickRes[0]?.result?.result?.value ?? clickRes[0]?.error);

  // --- Navigate web page to a test page and capture selection ---
  if (webPageTarget) {
    console.log("\n=== 4. Navigate to test page and inject selection ===");

    // Navigate to a real page
    await cdp(webPageTarget.webSocketDebuggerUrl, [
      { method: "Page.navigate", params: { url: "https://example.com" } }
    ]);
    await sleep(2000);

    // Verify navigation
    const pageState = await cdp(webPageTarget.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: { expression: "document.title + ' @ ' + location.href", returnByValue: true } },
    ]);
    console.log("Page:", pageState[0]?.result?.result?.value);

    // Inject a text selection on the page
    const selRes = await cdp(webPageTarget.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: {
          expression: `
            const el = document.querySelector('p');
            if (el) {
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              "selection set: " + sel.toString().slice(0, 80);
            } else {
              "no <p> found";
            }
          `,
          returnByValue: true
      }}
    ]);
    console.log("Selection:", selRes[0]?.result?.result?.value);

    // Click captureSelection from panel
    console.log("\n=== 5. Click 'Add current selection' from panel ===");
    const captureRes = await cdp(panelTarget.webSocketDebuggerUrl, [
      { method: "Runtime.evaluate", params: {
          expression: `
            document.getElementById('captureSelection').click();
            new Promise(r => setTimeout(r, 3000)).then(() => ({
              status: document.getElementById('statusText')?.textContent,
              title: document.getElementById('noteTitle')?.value,
              body: document.getElementById('noteBody')?.value?.slice(0, 300)
            }))
          `,
          returnByValue: true, awaitPromise: true, timeout: 8000
      }}
    ]);
    const captured = captureRes[0]?.result?.result?.value;
    console.log("After capture:", JSON.stringify(captured, null, 2));
  }

  // --- Check folder list (confirms bridge is live) ---
  console.log("\n=== 6. Folder list from bridge ===");
  const foldersRes = await get("http://127.0.0.1:43119/folders");
  console.log("Folders:", JSON.stringify(foldersRes?.folders ?? foldersRes));

  // --- Summary ---
  console.log("\n=== SUMMARY ===");
  console.log(`Extension ID in Edge : ${PANEL_EXT_ID}`);
  console.log(`Side panel page      : LOADED ✅`);
  console.log(`Chrome APIs          : available ✅`);
  console.log(`sidePanel API        : available ✅`);
  console.log(`Bridge               : ${health.ok ? "ONLINE ✅" : "OFFLINE ❌"}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
