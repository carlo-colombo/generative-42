// Shell service worker. vite-plugin-pwa-shell injects the build id and the
// precache list at build time; the copy in public/ is only a template.
const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = __PRECACHE_URLS__;

const SHELL_CACHE = `shell-${BUILD_ID}`;
const PREVIOUS_CACHE = "shell-previous";
const IMAGE_CACHE = "images";
const SHELL_URL = "/";
const MANIFEST_URL = "/assets/manifest.json";
const CACHE_FIRST_PREFIXES = ["/app/", "/fonts/", "/wasm/", "/icons/"];

// Durable build pointers, shared with src/pwa/image-cache.ts (gen42-pwa). The
// meta store uses out-of-line keys, so both sides have to create it the same way.
const META_DB = "gen42-pwa";
const META_DB_VERSION = 2;
const META_STORE = "meta";
const IMAGE_STORE = "images";

const ACTIVE_BUILD = "activeBuild";
const SELECTED_BUILD = "selectedBuild";
const PREVIOUS_BUILD = "previousBuild";
const LAST_READY_BUILD = "lastReadyBuild";

// Only the accept path claims clients, so a first visit keeps being served by
// the network and the page is never shadowed by a stale shell.
let skipWaitingRequested = false;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("meta request failed"));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("meta transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("meta transaction aborted"));
  });
}

function openMetaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DB, META_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "path" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("meta store open failed"));
    request.onblocked = () => reject(new Error("meta store blocked by another context"));
  });
}

function withMeta(mode, run) {
  return openMetaDb().then(async (db) => {
    try {
      const tx = db.transaction(META_STORE, mode);
      const result = await run(tx.objectStore(META_STORE));
      if (mode === "readwrite") await transactionDone(tx);
      return result;
    } finally {
      db.close();
    }
  });
}

async function metaGet(key) {
  try {
    const value = await withMeta("readonly", (store) => requestResult(store.get(key)));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function metaSet(key, value) {
  try {
    await withMeta("readwrite", (store) => requestResult(value === null ? store.delete(key) : store.put(value, key)));
    return true;
  } catch {
    return false;
  }
}

// The Cache API has no rename: copy the outgoing shell and drop the original so
// exactly two shell caches survive an activation.
async function renameCache(from, to) {
  const source = await caches.open(from);
  const target = await caches.open(to);
  for (const request of await source.keys()) {
    const response = await source.match(request);
    if (response) await target.put(request, response);
  }
  await caches.delete(from);
}

async function promoteShells() {
  const outgoing = await metaGet(ACTIVE_BUILD);
  const selected = (await metaGet(SELECTED_BUILD)) ?? outgoing;
  // A rollback pointer means the shell in use is already shell-previous: keep
  // it as the rollback copy instead of replacing it with the outgoing build.
  const rolledBack = Boolean(selected && outgoing && selected !== outgoing);
  if (outgoing && outgoing !== BUILD_ID) {
    if (rolledBack) {
      // shell-previous already holds the selected (rolled-back) build, so the
      // pointer has to name that build: the panel and the next activation read
      // it to label and promote the rollback copy.
      await metaSet(PREVIOUS_BUILD, selected);
    } else {
      const outgoingShell = `shell-${outgoing}`;
      if (await caches.has(outgoingShell)) {
        await caches.delete(PREVIOUS_CACHE);
        await renameCache(outgoingShell, PREVIOUS_CACHE);
        await metaSet(PREVIOUS_BUILD, outgoing);
      }
    }
  }
  for (const name of await caches.keys()) {
    if (name.startsWith("shell-") && name !== SHELL_CACHE && name !== PREVIOUS_CACHE) {
      await caches.delete(name);
    }
  }
  if (!(await caches.has(PREVIOUS_CACHE))) await metaSet(PREVIOUS_BUILD, null);
}

async function activate() {
  try {
    await promoteShells();
  } catch {
    // A failed copy must not fail activation: the shell is still cached under
    // its build name, and only rollback is lost.
  }
  await metaSet(ACTIVE_BUILD, BUILD_ID);
  await metaSet(SELECTED_BUILD, BUILD_ID);
  // A waiting worker takes over only because the page asked for it.
  if (skipWaitingRequested) {
    await self.clients.claim().catch(() => {});
  }
}

async function state() {
  const [activeBuild, previousBuild, lastReadyBuild, selectedBuild, hasPrevious] = await Promise.all([
    metaGet(ACTIVE_BUILD),
    metaGet(PREVIOUS_BUILD),
    metaGet(LAST_READY_BUILD),
    metaGet(SELECTED_BUILD),
    caches.has(PREVIOUS_CACHE),
  ]);
  return {
    // This worker's own build, so a waiting worker can report which build waits.
    buildId: BUILD_ID,
    activeBuild,
    previousBuild,
    lastReadyBuild,
    selectedBuild,
    // A build that has not rendered anything yet can be rolled back, and only
    // while a previous shell is still on the device.
    canRollback: Boolean(hasPrevious && activeBuild && lastReadyBuild !== activeBuild),
  };
}

async function rollback() {
  const previous = await metaGet(PREVIOUS_BUILD);
  if (!previous || !(await caches.has(PREVIOUS_CACHE))) return { ok: false, buildId: null };
  // The pointer flip is all it takes: the next navigation is served from
  // shell-previous and its /app chunks resolve there. The page reloads.
  await metaSet(SELECTED_BUILD, previous);
  return { ok: true, buildId: previous };
}

async function stageReady(reportingBuild) {
  if (reportingBuild) await metaSet(LAST_READY_BUILD, reportingBuild);
  const activeBuild = await metaGet(ACTIVE_BUILD);
  // The new shell proved that it renders, so the rollback copy is spent.
  if (reportingBuild && reportingBuild === activeBuild) {
    await caches.delete(PREVIOUS_CACHE);
    await metaSet(PREVIOUS_BUILD, null);
  }
}

self.addEventListener("install", (event) => {
  // No skipWaiting: a new build waits until the page asks for it.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const port = event.ports && event.ports[0];
  if (data.type === "skipWaiting") {
    skipWaitingRequested = true;
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (data.type === "rollback") {
    event.waitUntil(rollback().then((result) => port?.postMessage(result)));
    return;
  }
  if (data.type === "get-state") {
    event.waitUntil(state().then((result) => port?.postMessage(result)));
    return;
  }
  if (data.type === "stage-ready") {
    event.waitUntil(stageReady(typeof data.buildId === "string" ? data.buildId : BUILD_ID));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (request.mode === "navigate") {
    event.respondWith(serveShell(request));
    return;
  }
  if (path === "/sw.js" || path.endsWith(".webmanifest")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (path === MANIFEST_URL) {
    event.respondWith(serveManifest(request, event));
    return;
  }
  if (path.startsWith("/assets/")) {
    // Built-in images are network resources, not part of the shell: cache each
    // one the first time it loads and serve it from there afterwards.
    event.respondWith(serveImage(request));
    return;
  }
  if (CACHE_FIRST_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
  }
});

// The shell a navigation is served from: the active build unless a rollback
// moved the pointer to shell-previous.
async function selectedShellName() {
  const selected = await metaGet(SELECTED_BUILD);
  if (!selected || selected === BUILD_ID) return SHELL_CACHE;
  if (selected === (await metaGet(PREVIOUS_BUILD)) && (await caches.has(PREVIOUS_CACHE))) return PREVIOUS_CACHE;
  return SHELL_CACHE;
}

async function serveShell(request) {
  const cache = await caches.open(await selectedShellName());
  const shell = await cache.match(SHELL_URL);
  if (shell) return shell;
  return fetch(request);
}

async function cacheFirst(request) {
  const name = await selectedShellName();
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Fill the shell that is serving this page, so a rolled-back shell can reach
  // anything its precache missed.
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function serveImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function serveManifest(request, event) {
  const cache = await caches.open(await selectedShellName());
  const cached = await cache.match(MANIFEST_URL);
  const revalidate = fetch(request, { cache: "no-store" }).then(async (response) => {
    if (response.ok) await cache.put(MANIFEST_URL, response.clone());
    return response;
  });
  if (!cached) return revalidate;
  event.waitUntil(revalidate.catch(() => {}));
  return cached;
}
