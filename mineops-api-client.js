// MineOps production API adapter.
// This file is intentionally framework-free so the current static React prototype can load it
// before the app bundle and migrate screens one data call at a time.
(function () {
  const DEFAULT_HEADERS = {
    "Content-Type": "application/json"
  };

  const QUEUE_KEY = "mineops.sync.queue.v1";
  const CACHE_KEY = "mineops.bootstrap.cache.v1";

  function config() {
    return window.MINEOPS_API || {
      baseUrl: window.location.origin,
      orgId: "org_demo",
      siteId: "site_demo_mine",
      userId: "user_admin",
      apiKey: ""
    };
  }

  function headers() {
    const c = config();
    return {
      ...DEFAULT_HEADERS,
      "X-MineOps-Org": c.orgId,
      "X-MineOps-Site": c.siteId,
      "X-MineOps-User": c.userId,
      ...(c.apiKey ? { "X-MineOps-Key": c.apiKey } : {})
    };
  }

  async function request(path, options) {
    const c = config();
    const response = await fetch(`${c.baseUrl}${path}`, {
      ...options,
      headers: { ...headers(), ...(options && options.headers ? options.headers : {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `MineOps API ${response.status}`);
    return body;
  }

  function readQueue() {
    try {
      const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  async function enqueue(path, payload) {
    const item = { id: crypto.randomUUID(), path, payload, createdAt: new Date().toISOString() };
    const queue = readQueue();
    queue.push(item);
    writeQueue(queue);
    return item;
  }

  async function mutate(path, payload) {
    if (!navigator.onLine) return { queued: true, item: await enqueue(path, payload) };
    try {
      return await request(path, { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      return { queued: true, item: await enqueue(path, payload), error: error.message };
    }
  }

  async function syncQueue() {
    if (!navigator.onLine) return { synced: 0, remaining: readQueue().length };
    const queue = readQueue();
    const remaining = [];
    let synced = 0;
    for (const item of queue) {
      try {
        await request(item.path, { method: "POST", body: JSON.stringify(item.payload) });
        synced += 1;
      } catch {
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    return { synced, remaining: remaining.length };
  }

  async function bootstrap() {
    try {
      const data = await request("/api/bootstrap", { method: "GET" });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data }));
      return data;
    } catch (error) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached).data;
      throw error;
    }
  }

  window.MineOpsApi = {
    request,
    bootstrap,
    syncQueue,
    queue: readQueue,
    listWorkplaceExams: () => request("/api/workplace-exams", { method: "GET" }),
    listHazards: () => request("/api/hazards", { method: "GET" }),
    listEquipment: () => request("/api/equipment", { method: "GET" }),
    listEquipmentChecks: () => request("/api/equipment-checks", { method: "GET" }),
    listShiftLogs: () => request("/api/shift-logs", { method: "GET" }),
    listAuditEvents: () => request("/api/audit-events", { method: "GET" }),
    createWorkplaceExam: (payload) => mutate("/api/workplace-exams", payload),
    createHazard: (payload) => mutate("/api/hazards", payload),
    createEquipmentCheck: (payload) => mutate("/api/equipment-checks", payload),
    createShiftLog: (payload) => mutate("/api/shift-logs", payload)
  };

  window.addEventListener("online", () => syncQueue());
})();
