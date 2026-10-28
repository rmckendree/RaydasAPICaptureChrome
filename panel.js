const entries = [];
let idCounter = 0;
let paused = false;
let activeId = null;          // entry shown in the detail pane

const rowsEl = document.getElementById("rows");
const hostFilterEl = document.getElementById("hostFilter");
const countEl = document.getElementById("count");
const decodeChk = document.getElementById("decodeChk");
const detailPane = document.getElementById("detailPane");
const detailTitle = document.getElementById("detailTitle");
const detailJson = document.getElementById("detailJson");

function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return ""; }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function passesFilter(entry) {
  const f = hostFilterEl.value.trim().toLowerCase();
  if (!f) return true;
  return entry.host.toLowerCase().includes(f);
}

function render() {
  rowsEl.innerHTML = "";
  const visible = entries.filter(passesFilter);
  countEl.textContent = `${visible.length} / ${entries.length} requests`;
  for (const entry of visible) {
    const tr = document.createElement("tr");
    tr.dataset.id = entry.id;
    if (entry.id === activeId) tr.className = "active";
    const statusClass = entry.status >= 400 || entry.status === 0 ? "status-err" : "status-ok";
    tr.innerHTML = `
      <td><input type="checkbox" class="rowSelect" data-id="${entry.id}" ${entry.selected ? "checked" : ""}></td>
      <td>${escapeHtml(entry.method)}</td>
      <td class="${statusClass}">${entry.status}</td>
      <td>${escapeHtml(entry.host)}</td>
      <td title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</td>
    `;
    rowsEl.appendChild(tr);
  }
  rowsEl.querySelectorAll(".rowSelect").forEach(cb => {
    cb.addEventListener("change", e => {
      const id = Number(e.target.dataset.id);
      const entry = entries.find(x => x.id === id);
      if (entry) entry.selected = e.target.checked;
    });
  });
  rowsEl.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", e => {
      if (e.target.classList.contains("rowSelect")) return;
      showDetail(Number(tr.dataset.id));
    });
  });
}

function captureEntry(harEntry) {
  if (paused) return;
  const req = harEntry.request;
  const res = harEntry.response;
  const url = req.url;

  const entry = {
    id: ++idCounter,
    startedDateTime: harEntry.startedDateTime,
    durationMs: Math.round(harEntry.time || 0),
    method: req.method,
    url,
    host: hostOf(url),
    path: (() => { try { return new URL(url).pathname + (new URL(url).search || ""); } catch (e) { return url; } })(),
    status: res ? res.status : 0,
    statusText: res ? res.statusText || "" : "",
    requestHeaders: (req.headers || []).map(h => ({ name: h.name, value: h.value })),
    requestBody: req.postData ? req.postData.text || "" : "",
    requestBodyMimeType: req.postData ? req.postData.mimeType || "" : "",
    responseHeaders: (res && res.headers) ? res.headers.map(h => ({ name: h.name, value: h.value })) : [],
    responseBody: "",
    responseBodyEncoding: "",
    responseBodyLoaded: false,
    responseBodyMimeType: (res && res.content && res.content.mimeType) ? res.content.mimeType : "",
    selected: false
  };
  entries.push(entry);
  render();

  // Fetch response body asynchronously; harEntry.getContent is only
  // reliable right after the request finishes, so call it immediately.
  try {
    harEntry.getContent((content, encoding) => {
      entry.responseBody = content || "";
      entry.responseBodyEncoding = encoding || "";
      entry.responseBodyLoaded = true;
      if (entry.id === activeId) showDetail(entry.id);
    });
  } catch (e) {
    // Some entries (e.g. cancelled requests) may not support getContent.
  }
}

chrome.devtools.network.onRequestFinished.addListener(captureEntry);

document.getElementById("clearBtn").addEventListener("click", () => {
  entries.length = 0;
  closeDetail();
  render();
});

document.getElementById("pauseBtn").addEventListener("change", e => {
  paused = e.target.checked;
});

hostFilterEl.addEventListener("input", render);

decodeChk.addEventListener("change", () => {
  if (activeId !== null) showDetail(activeId);
});

document.getElementById("selectAll").addEventListener("change", e => {
  const checked = e.target.checked;
  entries.filter(passesFilter).forEach(entry => entry.selected = checked);
  render();
});

// ---------- Decoding ----------

function base64ToText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  // fatal: true throws on binary data (images, fonts...) so we keep those as base64.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function looksLikeJson(text) {
  const t = text.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

// Parse JSON that was stringified inside JSON (e.g. {"payload":"{\"a\":1}"}).
function decodeNested(value, depth = 0) {
  if (depth > 5) return value;
  if (typeof value === "string" && looksLikeJson(value)) {
    try { return decodeNested(JSON.parse(value), depth + 1); } catch (e) { return value; }
  }
  if (Array.isArray(value)) return value.map(v => decodeNested(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeNested(v, depth + 1);
    return out;
  }
  return value;
}

function paramsToObject(params) {
  const out = {};
  for (const [key, value] of params) {
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

function decodeBody(text, mimeType) {
  if (!text) return text;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("json") || looksLikeJson(text)) {
    try { return decodeNested(JSON.parse(text)); } catch (e) { /* not valid JSON */ }
  }
  if (mime.includes("x-www-form-urlencoded")) {
    try { return decodeNested(paramsToObject(new URLSearchParams(text))); } catch (e) { /* fall through */ }
  }
  return text;
}

function base64UrlToJson(part) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(base64ToText(b64));
}

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;

function decodeJwt(token) {
  const [header, payload] = token.split(".");
  try {
    const decoded = { header: base64UrlToJson(header), payload: base64UrlToJson(payload) };
    for (const claim of ["exp", "iat", "nbf"]) {
      if (typeof decoded.payload[claim] === "number") {
        decoded.payload[`${claim}_readable`] = new Date(decoded.payload[claim] * 1000).toISOString();
      }
    }
    return decoded;
  } catch (e) {
    return null;
  }
}

// ---------- Simple JSON (request + response) ----------

function headersToObject(headers) {
  const out = {};
  headers
    .filter(h => h.name && !h.name.startsWith(":"))
    .forEach(h => {
      if (h.name in out) out[h.name] = [].concat(out[h.name], h.value);
      else out[h.name] = h.value;
    });
  return out;
}

function responseBodyFor(entry, decode) {
  if (!entry.responseBodyLoaded) return { body: null, note: "response body not available" };
  let text = entry.responseBody;
  let encoding = entry.responseBodyEncoding;
  if (decode && encoding === "base64") {
    try { text = base64ToText(text); encoding = ""; } catch (e) { /* binary - keep base64 */ }
  }
  const result = { body: decode ? decodeBody(text, entry.responseBodyMimeType) : text };
  if (encoding) result.encoding = encoding;
  return result;
}

function toSimpleJson(entry) {
  const decode = decodeChk.checked;
  const request = {
    headers: headersToObject(entry.requestHeaders),
    body: decode ? decodeBody(entry.requestBody, entry.requestBodyMimeType) : entry.requestBody
  };
  if (decode) {
    try {
      const params = new URL(entry.url).searchParams;
      if ([...params.keys()].length) request.query = decodeNested(paramsToObject(params));
    } catch (e) { /* bad URL */ }

    const tokens = {};
    entry.requestHeaders.forEach(h => {
      const match = (h.value || "").match(JWT_RE);
      if (match) {
        const jwt = decodeJwt(match[0]);
        if (jwt) tokens[h.name] = jwt;
      }
    });
    if (Object.keys(tokens).length) request.decodedTokens = tokens;
  }

  const response = {
    status: entry.status,
    statusText: entry.statusText,
    headers: headersToObject(entry.responseHeaders),
    mimeType: entry.responseBodyMimeType,
    ...responseBodyFor(entry, decode)
  };

  return {
    timestamp: entry.startedDateTime,
    durationMs: entry.durationMs,
    method: entry.method,
    url: entry.url,
    request,
    response
  };
}

function simpleJsonText(selected) {
  const data = selected.length === 1 ? toSimpleJson(selected[0]) : selected.map(toSimpleJson);
  return JSON.stringify(data, null, 2);
}

function exportSimpleJson(selected) {
  downloadBlob(`api-capture-${Date.now()}.json`, simpleJsonText(selected), "application/json");
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch (e) {
    window.prompt("Copy manually (Ctrl+C):", text);
  }
}

document.getElementById("copyJsonBtn").addEventListener("click", e => {
  const selected = entries.filter(x => x.selected);
  if (selected.length === 0) {
    alert("No requests selected. Check the boxes next to the requests you want to copy.");
    return;
  }
  copyText(simpleJsonText(selected), e.target);
});

// ---------- Detail pane ----------

function showDetail(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) return;
  activeId = id;
  detailTitle.textContent = `${entry.method} ${entry.status} ${entry.path}`;
  detailJson.textContent = JSON.stringify(toSimpleJson(entry), null, 2);
  detailPane.classList.add("open");
  rowsEl.querySelectorAll("tr").forEach(tr => tr.classList.toggle("active", Number(tr.dataset.id) === id));
}

function closeDetail() {
  activeId = null;
  detailPane.classList.remove("open");
  rowsEl.querySelectorAll("tr.active").forEach(tr => tr.classList.remove("active"));
}

document.getElementById("detailCopyBtn").addEventListener("click", e => {
  copyText(detailJson.textContent, e.target);
});

document.getElementById("detailCloseBtn").addEventListener("click", closeDetail);

// ---------- Postman / Bruno export ----------

function toPostmanHeader(headers) {
  return headers
    .filter(h => h.name && !h.name.toLowerCase().startsWith(":"))
    .map(h => ({ key: h.name, value: h.value }));
}

function toPostmanUrl(urlStr) {
  const u = new URL(urlStr);
  return {
    raw: urlStr,
    protocol: u.protocol.replace(":", ""),
    host: u.hostname.split("."),
    port: u.port || undefined,
    path: u.pathname.split("/").filter(Boolean),
    query: Array.from(u.searchParams.entries()).map(([key, value]) => ({ key, value }))
  };
}

function downloadBlob(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPostman(selected, includeResponse) {
  const collection = {
    info: {
      name: `API Capture Export - ${new Date().toISOString()}`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: selected.map(entry => {
      const item = {
        name: `${entry.method} ${entry.path}`,
        request: {
          method: entry.method,
          header: toPostmanHeader(entry.requestHeaders),
          url: toPostmanUrl(entry.url)
        },
        response: []
      };
      if (entry.requestBody) {
        item.request.body = {
          mode: "raw",
          raw: entry.requestBody,
          options: { raw: { language: entry.requestBodyMimeType.includes("json") ? "json" : "text" } }
        };
      }
      if (includeResponse && entry.responseBody && entry.responseBodyEncoding !== "base64") {
        item.response.push({
          name: `Captured response (${entry.status})`,
          originalRequest: item.request,
          status: "",
          code: entry.status,
          header: toPostmanHeader(entry.responseHeaders),
          body: entry.responseBody
        });
      }
      return item;
    })
  };
  downloadBlob(`api-capture-${Date.now()}.postman_collection.json`, JSON.stringify(collection, null, 2), "application/json");
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_ ]/gi, "_").slice(0, 80);
}

function guessBodyBlockType(mimeType) {
  if (!mimeType) return "text";
  if (mimeType.includes("json")) return "json";
  if (mimeType.includes("x-www-form-urlencoded")) return "form-urlencoded";
  if (mimeType.includes("xml")) return "xml";
  return "text";
}

function buildBruFile(entry, seq, includeResponse) {
  const name = `${entry.method} ${entry.path}`;
  const methodLower = entry.method.toLowerCase();
  const hasBody = !!entry.requestBody;
  const bodyType = hasBody ? guessBodyBlockType(entry.requestBodyMimeType) : "none";

  let out = "";
  out += `meta {\n  name: ${name}\n  type: http\n  seq: ${seq}\n}\n\n`;
  out += `${methodLower} {\n  url: ${entry.url}\n  body: ${hasBody ? bodyType : "none"}\n  auth: none\n}\n\n`;

  const headerLines = entry.requestHeaders
    .filter(h => h.name && !h.name.toLowerCase().startsWith(":"))
    .map(h => `  ${h.name}: ${h.value}`)
    .join("\n");
  if (headerLines) {
    out += `headers {\n${headerLines}\n}\n\n`;
  }

  if (hasBody) {
    out += `body:${bodyType} {\n${entry.requestBody}\n}\n\n`;
  }

  if (includeResponse && entry.responseBody && entry.responseBodyEncoding !== "base64") {
    const truncated = entry.responseBody.length > 5000
      ? entry.responseBody.slice(0, 5000) + "\n...[truncated]"
      : entry.responseBody;
    out += `docs {\n  Captured response status: ${entry.status}\n\n  ${truncated.replace(/\n/g, "\n  ")}\n}\n`;
  }

  return out.trim() + "\n";
}

function exportBru(selected, includeResponse) {
  // Bruno collections are a folder of .bru files plus a bruno.json.
  // We trigger sequential downloads; move them into one folder afterward.
  downloadBlob("bruno.json", JSON.stringify({
    version: "1",
    name: "API Capture Export",
    type: "collection"
  }, null, 2), "application/json");

  selected.forEach((entry, i) => {
    setTimeout(() => {
      const filename = `${sanitizeFilename(`${i + 1}-${entry.method}-${entry.path}`)}.bru`;
      downloadBlob(filename, buildBruFile(entry, i + 1, includeResponse), "text/plain");
    }, (i + 1) * 200);
  });
}

document.getElementById("exportBtn").addEventListener("click", () => {
  const selected = entries.filter(e => e.selected);
  if (selected.length === 0) {
    alert("No requests selected. Check the boxes next to the requests you want to export.");
    return;
  }
  const includeResponse = document.getElementById("includeResponse").checked;
  const format = document.getElementById("exportFormat").value;

  if (format === "postman") {
    exportPostman(selected, includeResponse);
  } else if (format === "simple") {
    // Simple JSON always includes the response; that's its point.
    exportSimpleJson(selected);
  } else {
    exportBru(selected, includeResponse);
  }
});

function escapeSingleQuotes(str) {
  return str.replace(/'/g, `'\\''`);
}

function buildCurl(entry) {
  const parts = [`curl -X ${entry.method}`, `'${escapeSingleQuotes(entry.url)}'`];

  entry.requestHeaders
    .filter(h => h.name && !h.name.toLowerCase().startsWith(":"))
    .forEach(h => {
      parts.push(`-H '${escapeSingleQuotes(h.name)}: ${escapeSingleQuotes(h.value)}'`);
    });

  if (entry.requestBody) {
    parts.push(`--data-raw '${escapeSingleQuotes(entry.requestBody)}'`);
  }

  return parts.join(" \\\n  ");
}

document.getElementById("copyCurlBtn").addEventListener("click", e => {
  const selected = entries.filter(x => x.selected);
  if (selected.length === 0) {
    alert("No requests selected. Check the boxes next to the requests you want to copy.");
    return;
  }
  copyText(selected.map(buildCurl).join("\n\n"), e.target);
});

render();
