const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const PUBLIC_ROUTES = new Set(["/api/health", "/api/session"]);
const ROLES = new Set(["owner", "admin", "manager", "supervisor", "mechanic", "crew", "readonly"]);

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return withSecurity(await handleApi(request, env, url));
      }
      return withSecurity(await handleAsset(request, env, url));
    } catch (error) {
      if (error && Number.isInteger(error.status)) {
        return withSecurity(json({ error: error.message }, error.status));
      }
      console.error(error);
      return withSecurity(json({ error: "Internal server error", requestId: crypto.randomUUID() }, 500));
    }
  }
};

async function handleAsset(request, env, url) {
  const prettyRoutes = {
    "/login": "/login.html",
    "/login/": "/login.html",
    "/walkthrough": "/walkthrough.html",
    "/walkthrough/": "/walkthrough.html",
    "/field": "/field.html",
    "/field/": "/field.html",
    "/app": "/field.html",
    "/app/": "/field.html",
    "/mineops": "/mineops/index.html",
    "/mineops/": "/mineops/index.html"
  };
  if (request.method === "GET" && prettyRoutes[url.pathname]) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = prettyRoutes[url.pathname];
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  }
  return env.ASSETS.fetch(request);
}

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (url.pathname === "/api/health") return json({ ok: true, service: "mineops", time: new Date().toISOString() });
  if (url.pathname === "/api/session" && request.method === "POST") return createSession(request, env);
  if (url.pathname === "/api/session" && request.method === "DELETE") return deleteSession(request, env);

  const actor = await authenticate(request, env);
  if (!actor) return json({ error: "Unauthorized" }, 401);

  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case "GET /api/bootstrap":
      return json(await getBootstrap(env, actor));
    case "GET /api/workplace-exams":
      return json({ workplaceExams: await listRows(env, actor, "workplace_exams", "exam_date DESC, created_at DESC") });
    case "POST /api/workplace-exams":
      return json({ workplaceExam: await createWorkplaceExam(request, env, actor) }, 201);
    case "GET /api/hazards":
      return json({ hazards: await listRows(env, actor, "hazards", "created_at DESC") });
    case "POST /api/hazards":
      return json({ hazard: await createHazard(request, env, actor) }, 201);
    case "GET /api/equipment":
      return json({ equipment: await listRows(env, actor, "equipment", "asset_tag ASC") });
    case "GET /api/equipment-checks":
      return json({ equipmentChecks: await listRows(env, actor, "equipment_checks", "check_date DESC, created_at DESC") });
    case "POST /api/equipment-checks":
      return json({ equipmentCheck: await createEquipmentCheck(request, env, actor) }, 201);
    case "GET /api/shift-logs":
      return json({ shiftLogs: await listRows(env, actor, "shift_logs", "shift_date DESC, created_at DESC") });
    case "POST /api/shift-logs":
      return json({ shiftLog: await createShiftLog(request, env, actor) }, 201);
    case "GET /api/audit-events":
      requireRole(actor, ["owner", "admin", "manager", "readonly"]);
      return json({ auditEvents: await listRows(env, actor, "audit_events", "created_at DESC", 200) });
    default:
      return json({ error: "Not found" }, 404);
  }
}

async function authenticate(request, env) {
  if (PUBLIC_ROUTES.has(new URL(request.url).pathname)) return { public: true };

  const orgId = request.headers.get("X-MineOps-Org") || "org_demo";
  const siteId = request.headers.get("X-MineOps-Site") || "site_demo_mine";
  const userId = request.headers.get("X-MineOps-User") || "user_admin";

  const apiKey = request.headers.get("X-MineOps-Key") || bearerToken(request);
  if (env.MINEOPS_API_KEY && apiKey === env.MINEOPS_API_KEY) {
    const user = await findUser(env, orgId, userId);
    return user ? { ...user, orgId, siteId } : null;
  }

  const sessionId = cookie(request, "mineops_session");
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    `SELECT s.org_id, s.site_id, s.user_id, u.email, u.name, u.role, u.active
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`
  ).bind(sessionId, now()).first();
  if (!session || !ROLES.has(session.role)) return null;
  return {
    id: session.user_id,
    org_id: session.org_id,
    email: session.email,
    name: session.name,
    role: session.role,
    active: session.active,
    orgId: session.org_id,
    siteId: session.site_id
  };
}

async function findUser(env, orgId, userId) {
  const user = await env.DB.prepare(
    "SELECT id, org_id, email, name, role, active FROM users WHERE org_id = ? AND id = ? AND active = 1"
  ).bind(orgId, userId).first();
  return user && ROLES.has(user.role) ? user : null;
}

async function createSession(request, env) {
  const body = await readJson(request);
  const setupCode = requiredString(body.setupCode, "setupCode");
  const expected = env.MINEOPS_SETUP_CODE || env.MINEOPS_API_KEY;
  if (!expected || setupCode !== expected) return json({ error: "Invalid setup code" }, 401);

  const orgId = body.orgId || "org_demo";
  const siteId = body.siteId || "site_demo_mine";
  const userId = body.userId || "user_admin";
  const user = await findUser(env, orgId, userId);
  if (!user) return json({ error: "User not found" }, 404);

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  await env.DB.prepare("INSERT INTO user_sessions (id, org_id, site_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(sessionId, orgId, siteId, userId, expiresAt).run();

  const response = json({ ok: true, user: mapRow(user), expiresAt });
  response.headers.append("Set-Cookie", sessionCookie(sessionId, expiresAt));
  return response;
}

async function deleteSession(request, env) {
  const sessionId = cookie(request, "mineops_session");
  if (sessionId) await env.DB.prepare("DELETE FROM user_sessions WHERE id = ?").bind(sessionId).run();
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", "mineops_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  return response;
}

function cookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return "";
}

function sessionCookie(sessionId, expiresAt) {
  return `mineops_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${new Date(expiresAt).toUTCString()}`;
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function getBootstrap(env, actor) {
  const [org, site, users, equipment, openHazards] = await Promise.all([
    env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(actor.orgId).first(),
    env.DB.prepare("SELECT * FROM sites WHERE org_id = ? AND id = ?").bind(actor.orgId, actor.siteId).first(),
    env.DB.prepare("SELECT id, email, name, role, active FROM users WHERE org_id = ? ORDER BY name").bind(actor.orgId).all(),
    listRows(env, actor, "equipment", "asset_tag ASC"),
    env.DB.prepare("SELECT * FROM hazards WHERE org_id = ? AND site_id = ? AND status IN ('open','controlled') ORDER BY created_at DESC LIMIT 25").bind(actor.orgId, actor.siteId).all()
  ]);

  return {
    organization: mapRow(org),
    site: site ? { ...mapRow(site), config: parseJson(site.config_json, {}) } : null,
    currentUser: actor,
    users: users.results.map(mapRow),
    equipment,
    openHazards: openHazards.results.map(mapRow)
  };
}

async function listRows(env, actor, table, orderBy, limit = 100) {
  assertKnownTable(table);
  const rows = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE org_id = ? AND site_id = ? ORDER BY ${orderBy} LIMIT ?`
  ).bind(actor.orgId, actor.siteId, limit).all();
  return rows.results.map(mapRow);
}

async function createWorkplaceExam(request, env, actor) {
  requireRole(actor, ["owner", "admin", "manager", "supervisor", "crew"]);
  const body = await readJson(request);
  const record = {
    id: body.id || crypto.randomUUID(),
    org_id: actor.orgId,
    site_id: actor.siteId,
    area: requiredString(body.area, "area"),
    shift: requiredString(body.shift, "shift"),
    exam_date: requiredString(body.examDate, "examDate"),
    examiner_user_id: body.examinerUserId || actor.id,
    status: enumValue(body.status || "draft", ["draft", "submitted", "reviewed", "void"], "status"),
    conditions_json: JSON.stringify(body.conditions || []),
    submitted_at: body.status === "submitted" ? now() : null
  };
  await env.DB.prepare(`INSERT INTO workplace_exams (id, org_id, site_id, area, shift, exam_date, examiner_user_id, status, conditions_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.org_id, record.site_id, record.area, record.shift, record.exam_date, record.examiner_user_id, record.status, record.conditions_json, record.submitted_at).run();
  await audit(env, actor, "workplace_exam", record.id, "create", null, record);
  return mapRow(record);
}

async function createHazard(request, env, actor) {
  requireRole(actor, ["owner", "admin", "manager", "supervisor", "mechanic", "crew"]);
  const body = await readJson(request);
  const record = {
    id: body.id || crypto.randomUUID(),
    org_id: actor.orgId,
    site_id: actor.siteId,
    source_type: enumValue(body.sourceType || "manual", ["workplace_exam", "equipment_check", "manual", "incident"], "sourceType"),
    source_id: body.sourceId || null,
    title: requiredString(body.title, "title"),
    description: body.description || "",
    location: body.location || "",
    severity: enumValue(body.severity || "medium", ["low", "medium", "high", "critical"], "severity"),
    status: enumValue(body.status || "open", ["open", "controlled", "corrected", "void"], "status"),
    due_at: body.dueAt || null
  };
  await env.DB.prepare(`INSERT INTO hazards (id, org_id, site_id, source_type, source_id, title, description, location, severity, status, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.org_id, record.site_id, record.source_type, record.source_id, record.title, record.description, record.location, record.severity, record.status, record.due_at).run();
  await audit(env, actor, "hazard", record.id, "create", null, record);
  return mapRow(record);
}

async function createEquipmentCheck(request, env, actor) {
  requireRole(actor, ["owner", "admin", "manager", "supervisor", "mechanic", "crew"]);
  const body = await readJson(request);
  const equipment = await env.DB.prepare("SELECT id FROM equipment WHERE org_id = ? AND site_id = ? AND id = ?")
    .bind(actor.orgId, actor.siteId, requiredString(body.equipmentId, "equipmentId")).first();
  if (!equipment) throw httpError(404, "Equipment not found");

  const record = {
    id: body.id || crypto.randomUUID(),
    org_id: actor.orgId,
    site_id: actor.siteId,
    equipment_id: body.equipmentId,
    checked_by_user_id: body.checkedByUserId || actor.id,
    check_date: requiredString(body.checkDate, "checkDate"),
    status: enumValue(body.status, ["pass", "fail", "needs_attention"], "status"),
    readings_json: JSON.stringify(body.readings || {}),
    notes: body.notes || ""
  };
  await env.DB.prepare(`INSERT INTO equipment_checks (id, org_id, site_id, equipment_id, checked_by_user_id, check_date, status, readings_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.org_id, record.site_id, record.equipment_id, record.checked_by_user_id, record.check_date, record.status, record.readings_json, record.notes).run();
  await env.DB.prepare("UPDATE equipment SET last_check_at = ?, status = CASE WHEN ? = 'fail' THEN 'down' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(record.check_date, record.status, now(), record.equipment_id).run();
  await audit(env, actor, "equipment_check", record.id, "create", null, record);
  return mapRow(record);
}

async function createShiftLog(request, env, actor) {
  requireRole(actor, ["owner", "admin", "manager", "supervisor"]);
  const body = await readJson(request);
  const record = {
    id: body.id || crypto.randomUUID(),
    org_id: actor.orgId,
    site_id: actor.siteId,
    shift_date: requiredString(body.shiftDate, "shiftDate"),
    shift: requiredString(body.shift, "shift"),
    supervisor_user_id: body.supervisorUserId || actor.id,
    production_json: JSON.stringify(body.production || {}),
    handoff_notes: body.handoffNotes || "",
    status: enumValue(body.status || "draft", ["draft", "submitted", "locked"], "status"),
    submitted_at: body.status === "submitted" ? now() : null
  };
  await env.DB.prepare(`INSERT INTO shift_logs (id, org_id, site_id, shift_date, shift, supervisor_user_id, production_json, handoff_notes, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.org_id, record.site_id, record.shift_date, record.shift, record.supervisor_user_id, record.production_json, record.handoff_notes, record.status, record.submitted_at).run();
  await audit(env, actor, "shift_log", record.id, "create", null, record);
  return mapRow(record);
}

async function audit(env, actor, entityType, entityId, action, before, after) {
  await env.DB.prepare(`INSERT INTO audit_events (id, org_id, site_id, user_id, entity_type, entity_id, action, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actor.orgId, actor.siteId, actor.id, entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

function requireRole(actor, allowed) {
  if (!allowed.includes(actor.role)) throw httpError(403, "Forbidden");
}

async function readJson(request) {
  try { return await request.json(); } catch { throw httpError(400, "Invalid JSON body"); }
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, `${field} is required`);
  return value.trim();
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw httpError(400, `${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

function assertKnownTable(table) {
  if (!["workplace_exams", "hazards", "equipment", "equipment_checks", "shift_logs", "audit_events"].includes(table)) {
    throw httpError(500, "Unknown table");
  }
}

function mapRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = key.endsWith("_json") ? parseJson(value, key === "conditions_json" ? [] : {}) : value;
  }
  return out;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function now() {
  return new Date().toISOString();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders({ headers: new Headers() }) }
  });
}

function withSecurity(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-MineOps-Key, X-MineOps-Org, X-MineOps-Site, X-MineOps-User",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
