export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/health") {
        return json({ ok: true });
      }

      if (path === "/api/auth/register" && request.method === "POST") {
        return await handleRegister(request, env);
      }
      if (path === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (path === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }
      if (path === "/api/me" && request.method === "GET") {
        return await handleMe(request, env);
      }
      if (path === "/api/state" && request.method === "GET") {
        return await handleGetState(request, env);
      }
      if (path === "/api/state" && request.method === "PUT") {
        return await handlePutState(request, env);
      }
      if (path === "/api/parse-order" && request.method === "POST") {
        return await handleParseOrder(request, env);
      }

      if (path.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return json({ error: err?.message || "Internal server error" }, 500);
    }
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function randomId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt, pepper = "") {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${password}:${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader = "") {
  const out = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

function sessionCookie(token, maxAgeSeconds = 60 * 60 * 24 * 30) {
  return `solodesk_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie() {
  return "solodesk_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.solodesk_session;
  if (!token || !env.DB) return null;

  const pepper = env.AUTH_PEPPER || "";
  const tokenHash = await sha256Hex(`${token}:${pepper}`);
  const nowIso = new Date().toISOString();

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.plan
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(tokenHash, nowIso)
    .first();

  return row || null;
}

async function createSession(userId, env) {
  const token = randomId("sess");
  const pepper = env.AUTH_PEPPER || "";
  const tokenHash = await sha256Hex(`${token}:${pepper}`);
  const id = randomId("sid");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(id, userId, tokenHash, expiresAt)
    .run();

  return token;
}

async function handleRegister(request, env) {
  if (!env.DB) return json({ error: "Database binding missing" }, 500);
  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!email || !email.includes("@") || password.length < 8) {
    return json({ error: "Provide a valid email and a password of at least 8 characters." }, 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) {
    return json({ error: "An account with this email already exists." }, 409);
  }

  const userId = randomId("usr");
  const salt = randomId("salt");
  const pepper = env.AUTH_PEPPER || "";
  const passwordHash = await hashPassword(password, salt, pepper);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, plan, created_at) VALUES (?, ?, ?, ?, 'free', ?)`
  )
    .bind(userId, email, `${salt}:${passwordHash}`, salt, createdAt)
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (id, user_id, currency, updated_at) VALUES (?, ?, 'USD', ?)`
  )
    .bind(randomId("ws"), userId, createdAt)
    .run();

  const token = await createSession(userId, env);
  return json(
    { user: { id: userId, email, plan: "free" } },
    201,
    { "Set-Cookie": sessionCookie(token) }
  );
}

async function handleLogin(request, env) {
  if (!env.DB) return json({ error: "Database binding missing" }, 500);
  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, password_salt, plan FROM users WHERE email = ?`
  )
    .bind(email)
    .first();

  if (!user) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const pepper = env.AUTH_PEPPER || "";
  const salt = user.password_salt || (user.password_hash || "").split(":")[0] || "";
  const expectedHash = (user.password_hash || "").includes(":")
    ? (user.password_hash || "").split(":")[1]
    : user.password_hash;
  const actualHash = await hashPassword(password, salt, pepper);

  if (actualHash !== expectedHash) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const token = await createSession(user.id, env);
  return json(
    { user: { id: user.id, email: user.email, plan: user.plan || "free" } },
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.solodesk_session;
  if (token && env.DB) {
    const tokenHash = await sha256Hex(`${token}:${env.AUTH_PEPPER || ""}`);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return json({ authenticated: false, user: null }, 200);
  }
  return json({ authenticated: true, user });
}

async function handleGetState(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const ws = await env.DB.prepare(`SELECT currency FROM workspaces WHERE user_id = ?`).bind(user.id).first();
  const clientsRes = await env.DB.prepare(
    `SELECT id, name, email, notes, created_at FROM clients WHERE user_id = ?`
  )
    .bind(user.id)
    .all();
  const ordersRes = await env.DB.prepare(
    `SELECT id, client_id, title, service, price, currency, deadline, status, revision_limit, revisions_used, notes, created_at
     FROM orders WHERE user_id = ?`
  )
    .bind(user.id)
    .all();
  const paymentsRes = await env.DB.prepare(
    `SELECT id, order_id, amount, date, note FROM payments WHERE user_id = ?`
  )
    .bind(user.id)
    .all();

  const paymentsByOrder = new Map();
  for (const p of paymentsRes.results || []) {
    const list = paymentsByOrder.get(p.order_id) || [];
    list.push({
      id: p.id,
      amount: Number(p.amount) || 0,
      date: p.date || "",
      paidAt: p.date || "",
      note: p.note || ""
    });
    paymentsByOrder.set(p.order_id, list);
  }

  const clients = (clientsRes.results || []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email || "",
    notes: c.notes || "",
    createdAt: c.created_at || ""
  }));

  const orders = (ordersRes.results || []).map((o) => ({
    id: o.id,
    clientId: o.client_id,
    title: o.title,
    service: o.service || "",
    price: Number(o.price) || 0,
    currency: o.currency || ws?.currency || "USD",
    deadline: o.deadline || "",
    status: o.status || "pending",
    revisionLimit: Number(o.revision_limit ?? 2),
    revisionsUsed: Number(o.revisions_used ?? 0),
    notes: o.notes || "",
    payments: paymentsByOrder.get(o.id) || [],
    createdAt: o.created_at || ""
  }));

  return json({
    currency: ws?.currency || "USD",
    clients,
    orders
  });
}

async function handlePutState(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.clients) || !Array.isArray(body.orders)) {
    return json({ error: "Invalid state payload" }, 400);
  }

  const currency = String(body.currency || "USD");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO workspaces (id, user_id, currency, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at`
  )
    .bind(randomId("ws"), user.id, currency, nowIso)
    .run();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM payments WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM orders WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM clients WHERE user_id = ?`).bind(user.id)
  ]);

  const statements = [];
  for (const c of body.clients) {
    if (!c?.id || !c?.name) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO clients (id, user_id, name, email, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(String(c.id), user.id, String(c.name), String(c.email || ""), String(c.notes || ""), String(c.createdAt || nowIso))
    );
  }

  for (const o of body.orders) {
    if (!o?.id || !o?.title) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO orders (id, user_id, client_id, title, service, price, currency, deadline, status, revision_limit, revisions_used, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        String(o.id),
        user.id,
        String(o.clientId || ""),
        String(o.title),
        String(o.service || ""),
        Number(o.price) || 0,
        String(o.currency || currency),
        String(o.deadline || ""),
        String(o.status || "pending"),
        Number(o.revisionLimit ?? 2),
        Number(o.revisionsUsed ?? 0),
        String(o.notes || ""),
        String(o.createdAt || nowIso)
      )
    );

    for (const p of o.payments || []) {
      if (!p?.id) continue;
      statements.push(
        env.DB.prepare(
          `INSERT INTO payments (id, order_id, user_id, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(String(p.id), String(o.id), user.id, Number(p.amount) || 0, String(p.date || p.paidAt || nowIso.slice(0, 10)), String(p.note || ""))
      );
    }
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return json({ ok: true });
}

async function handleParseOrder(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  const message = String(body?.message || "").trim();
  if (!message) return json({ error: "Message is required" }, 400);

  const monthKey = new Date().toISOString().slice(0, 7);
  const limit = (user.plan || "free") === "pro" ? 300 : 15;

  const usageRow = await env.DB.prepare(
    `SELECT count FROM ai_usage WHERE user_id = ? AND month_key = ?`
  )
    .bind(user.id, monthKey)
    .first();

  const currentCount = Number(usageRow?.count || 0);
  if (currentCount >= limit) {
    return json(
      { error: `Monthly AI limit reached (${currentCount}/${limit}).`, code: "QUOTA_EXCEEDED", usage: { used: currentCount, limit } },
      429
    );
  }

  if (!env.GEMINI_API_KEY) {
    return json({ error: "GEMINI_API_KEY is not configured" }, 500);
  }

  const prompt = `Extract freelance order details from this client message and return ONLY valid JSON with keys: title, service, price, currency, deadline (YYYY-MM-DD or ""), notes.\n\nMessage:\n${message}`;
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );

  if (!geminiRes.ok) {
    return json({ error: "AI parser request failed" }, 502);
  }

  const geminiJson = await geminiRes.json();
  const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = {};
  }

  const nextCount = currentCount + 1;
  await env.DB.prepare(
    `INSERT INTO ai_usage (id, user_id, month_key, count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, month_key) DO UPDATE SET count = excluded.count`
  )
    .bind(randomId("ai"), user.id, monthKey, nextCount)
    .run();

  return json({
    data: {
      title: String(parsed.title || "New Client Order").slice(0, 75),
      service: String(parsed.service || ""),
      price: parsed.price ?? "",
      currency: String(parsed.currency || "USD").toUpperCase(),
      deadline: String(parsed.deadline || ""),
      notes: String(parsed.notes || message).slice(0, 950)
    },
    usage: { used: nextCount, limit }
  });
}
