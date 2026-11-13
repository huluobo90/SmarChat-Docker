import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { fileURLToPath } from "node:url";
import { pool, fail, tx, service, audit } from "../../packages/database/db";
import { digest } from "../../packages/security/crypto";
import { authRoutes, identify } from "./auth";
import { businessRoutes } from "./routes";
import { backupRoutes } from "./backup";
const app = Fastify({
  logger: {
    level: "info",
    redact: ["req.headers.cookie", "req.headers.authorization", "req.body"],
  },
  logController: new LogController({ disableRequestLogging: true }),
  bodyLimit: 30 * 1024 * 1024,
  trustProxy: false,
});
await app.register(cookie);
await app.register(rateLimit, {
  max: 600,
  timeWindow: "1 minute",
  hook: "preHandler",
  keyGenerator: (req: any) => req.actor?.id || req.ip,
});
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
await app.register(websocket);
app.addHook("onRequest", async (req: any, reply) => {
  reply
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "same-origin")
    .header("X-Frame-Options", "DENY");
  reply.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (!req.url.startsWith("/api/")) return;
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-smarchat"] !== "1"
  )
    fail(403, "缺少请求验证标识");
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== (process.env.PUBLIC_ORIGIN || "http://localhost:6081")
  )
    fail(403, "请求来源不允许");
  if (req.url.split("?")[0] === "/api/health") return;
  if (["/api/auth/login", "/api/auth/reset"].includes(req.url)) return;
  const actor = await identify(req);
  if (!actor) fail(401, "请先登录");
  req.actor = actor;
  if (!req.url.startsWith("/api/auth/") && actor.must_change)
    fail(403, "请先修改初始密码");
  if (
    (await pool.query("SELECT active FROM maintenance WHERE id=1")).rows[0]
      ?.active
  )
    fail(503, "系统正在维护，请稍后再试");
});
app.setErrorHandler((error: any, req, reply) => {
  if (req.url === "/api/auth/login" && error.statusCode === 401)
    void tx(service, (db) =>
      audit(db, service, "login.failed", undefined, {
        usernameHash: digest(String((req.body as any)?.username || "")),
      }),
    ).catch(() => {});
  const status =
    error.name === "ZodError"
      ? 400
      : error.code === "23505"
        ? 409
        : error.code === "22P02"
          ? 400
          : (
              {
                "42501": 403,
                P0002: 404,
                "22023": 400,
                "55006": 409,
                "23514": 400,
              } as any
            )[error.code] ||
            error.statusCode ||
            500;
  if (status >= 500)
    app.log.error({ code: error.code, type: error.name }, "Request failed");
  reply.code(status).send({
    error:
      status >= 500
        ? "服务暂时不可用，请稍后重试"
        : error.name === "ZodError"
          ? "输入格式不正确"
          : error.code === "23505"
            ? "记录已存在"
            : error.code === "22P02"
              ? "参数格式不正确"
              : error.message,
  });
});
app.get("/api/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true, version: "1.0.0-alpha.3" };
});
await authRoutes(app);
await businessRoutes(app);
await backupRoutes(app);
app.get("/api/events", { websocket: true }, (socket: any, req: any) => {
  // Never broadcast business payloads. Each refresh re-queries under current RLS.
  const timer = setInterval(async () => {
    try {
      const u = await identify(req);
      if (!u || u.must_change) {
        socket.close(1008);
        return;
      }
      socket.send(JSON.stringify({ type: "refresh", at: Date.now() }));
    } catch {
      socket.close(1011);
    }
  }, 3000);
  socket.on("close", () => clearInterval(timer));
  socket.on("error", () => clearInterval(timer));
});
await app.register(staticPlugin, {
  root: fileURLToPath(new URL("../../dist/web", import.meta.url)),
  wildcard: false,
});
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith("/api/")
    ? reply.code(404).send({ error: "接口不存在" })
    : reply.sendFile("index.html"),
);
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
