const http = require("http");
const fs = require("fs");
const { startServer } = require("../bridge/server");

function requestJson(method, path, payload, port, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              ...headers
            }
          : headers
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body: JSON.parse(responseBody)
          });
        });
      }
    );

    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function run() {
  const { server, port } = await startServer({ port: 43129 });

  try {
    const health = await requestJson("GET", "/health", null, port);
    if (health.statusCode !== 200 || !health.body.ok) {
      throw new Error("Health check failed.");
    }
    const token = health.body.pairingToken;
    if (!token) {
      throw new Error("Health check did not return a pairing token.");
    }

    const folders = await requestJson("GET", "/folders", null, port);
    if (folders.statusCode !== 200 || !folders.body.folders.includes("clips")) {
      throw new Error("Folder listing failed to expose the default clips folder.");
    }

    const noteResponse = await requestJson(
      "POST",
      "/notes",
      {
        title: "CV CLIP smoke test",
        folderPath: "clips",
        body: "This is a CV CLIP bridge smoke-test note.",
        sources: {
          "https://example.com/smoke-test": {
            title: "Smoke Test",
            url: "https://example.com/smoke-test"
          }
        }
      },
      port,
      { "X-CV-Clip-Token": token }
    );

    if (noteResponse.statusCode !== 201 || !noteResponse.body.note) {
      throw new Error("Note write failed.");
    }

    const noteFileContents = fs.readFileSync(noteResponse.body.note.absolutePath, "utf8");
    if (!noteFileContents.includes("## Sources")) {
      throw new Error("Created note did not include the source ledger.");
    }

    const missingTokenAttempt = await requestJson(
      "POST",
      "/notes",
      {
        title: "Missing token attempt",
        folderPath: "clips",
        body: "This should fail."
      },
      port
    );

    if (missingTokenAttempt.statusCode !== 401 || missingTokenAttempt.body.ok !== false) {
      throw new Error("Missing-token rejection failed.");
    }

    const appendResponse = await requestJson(
      "POST",
      `/notes/${noteResponse.body.note.id}/clips`,
      {
        title: "CV CLIP smoke test",
        folderPath: "clips",
        currentBody: "This is a CV CLIP bridge smoke-test note.",
        clipText: "Second clip body",
        clipBlock: "## Appended clip\n\nSecond clip body",
        sources: {
          "https://example.com/smoke-test": {
            title: "Smoke Test",
            url: "https://example.com/smoke-test"
          },
          "https://example.com/second": {
            title: "Second Page",
            url: "https://example.com/second"
          }
        }
      },
      port,
      { "X-CV-Clip-Token": token }
    );

    if (appendResponse.statusCode !== 200 || !appendResponse.body.note) {
      throw new Error("Clip append failed.");
    }

    const appendedContents = fs.readFileSync(noteResponse.body.note.absolutePath, "utf8");
    if (!appendedContents.includes("Second clip body")) {
      throw new Error("Appended clip content was not persisted.");
    }
    if (!appendedContents.includes("[Second Page](https://example.com/second)")) {
      throw new Error("Appended source ledger entry was not persisted.");
    }

    const alternateFolderResponse = await requestJson(
      "POST",
      "/notes",
      {
        title: "Existing note elsewhere",
        folderPath: "00 - Inbox",
        body: "Original body",
        sources: {
          "https://example.com/original": {
            title: "Original Page",
            url: "https://example.com/original"
          }
        }
      },
      port,
      { "X-CV-Clip-Token": token }
    );

    if (alternateFolderResponse.statusCode !== 201 || !alternateFolderResponse.body.note) {
      throw new Error("Alternate-folder seed note write failed.");
    }

    const reseededAppendResponse = await requestJson(
      "POST",
      "/notes",
      {
        title: "New folder append target",
        folderPath: "clips",
        body: "Original body\n\n## New clip\n\nMoved folder clip body",
        sources: {
          "https://example.com/original": {
            title: "Original Page",
            url: "https://example.com/original"
          },
          "https://example.com/moved": {
            title: "Moved Page",
            url: "https://example.com/moved"
          }
        }
      },
      port,
      { "X-CV-Clip-Token": token }
    );

    if (reseededAppendResponse.statusCode !== 201 || !reseededAppendResponse.body.note) {
      throw new Error("Folder-change append fallback note write failed.");
    }

    const reseededPath = reseededAppendResponse.body.note.absolutePath;
    const reseededContents = fs.readFileSync(reseededPath, "utf8");
    if (!reseededPath.includes("\\notes\\clips\\")) {
      throw new Error("Folder-change append did not land in clips.");
    }
    if (!reseededContents.includes("Moved folder clip body")) {
      throw new Error("Folder-change append content was not persisted.");
    }

    const traversalAttempt = await requestJson(
      "POST",
      "/notes",
      {
        title: "Traversal attempt",
        folderPath: "../../Desktop",
        body: "This should fail."
      },
      port
      ,
      { "X-CV-Clip-Token": token }
    );

    if (traversalAttempt.statusCode === 201 || traversalAttempt.body.ok !== false) {
      throw new Error("Traversal rejection failed.");
    }

    process.stdout.write(
      `Bridge smoke test passed. Wrote ${noteResponse.body.note.absolutePath}\n`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
