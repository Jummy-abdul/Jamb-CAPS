import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { scimSyncLogs } from "@/lib/db/schema";
import { ConfigError, getScimEnv } from "@/lib/env";
import { redact } from "@/lib/audit/log";
import { clientIp } from "@/lib/authz/principal";
import { ScimError } from "./errors";
import { SCIM_CONTENT_TYPE } from "./constants";

export interface ScimContext {
  req: Request;
  url: URL;
  /** e.g. https://caps.example.com/scim/v2 */
  baseUrl: string;
  body: unknown;
  ip: string | null;
}

export interface ScimResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  resourceId?: string | null;
  summary: string;
}

type Operation = "create" | "get" | "list" | "replace" | "patch" | "delete" | "discovery";

function tokenOk(req: Request): "ok" | "missing" | "invalid" | "unconfigured" {
  let expected: string;
  try {
    expected = getScimEnv().SCIM_TOKEN;
  } catch (e) {
    if (e instanceof ConfigError) return "unconfigured";
    throw e;
  }
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return "missing";
  // Compare fixed-length digests in constant time.
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) ? "ok" : "invalid";
}

function scimJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": `${SCIM_CONTENT_TYPE}; charset=utf-8`, "Cache-Control": "no-store", ...headers },
  });
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/**
 * Wrap a SCIM endpoint: bearer authentication, JSON parsing, uniform SCIM
 * error responses, and a sanitised entry in scim_sync_logs for every request.
 */
export function scimHandler(resourceType: "User" | "Group" | null, operation: Operation, fn: (ctx: ScimContext) => Promise<ScimResult>) {
  return async (req: Request): Promise<Response> => {
    const started = Date.now();
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    const baseUrl = `${proto}://${host}/scim/v2`;
    const ip = clientIp(req.headers);
    let body: unknown = undefined;
    let result: ScimResult;
    let errorDetail: string | null = null;

    try {
      const auth = tokenOk(req);
      if (auth === "unconfigured") throw new ScimError(503, "SCIM provisioning is not configured on this CAPS deployment");
      if (auth !== "ok") {
        const r = scimJson(401, new ScimError(401, auth === "missing" ? "Bearer token required" : "Invalid bearer token").toJSON(), { "WWW-Authenticate": 'Bearer realm="CAPS SCIM"' });
        await writeLog({ req, url, resourceType, operation, status: 401, started, summary: `Rejected: ${auth === "missing" ? "missing" : "invalid"} bearer token`, ip, body: undefined, errorDetail: null, resourceId: null });
        return r;
      }
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        const text = await req.text();
        if (text.length > 1_000_000) throw new ScimError(413, "Request body too large");
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          throw ScimError.invalidSyntax("Request body is not valid JSON");
        }
      }
      result = await fn({ req, url, baseUrl, body, ip });
    } catch (e) {
      if (e instanceof ScimError) {
        result = { status: e.status, body: e.toJSON(), summary: `Error: ${e.detail}` };
        errorDetail = e.detail;
      } else if (isUniqueViolation(e)) {
        const err = ScimError.uniqueness("A resource with the same unique attribute already exists");
        result = { status: 409, body: err.toJSON(), summary: "Error: uniqueness conflict" };
        errorDetail = err.detail;
      } else {
        console.error("[scim] unexpected error", operation, resourceType, e instanceof Error ? e.message : e);
        const err = new ScimError(500, "Internal server error");
        result = { status: 500, body: err.toJSON(), summary: "Error: internal server error" };
        errorDetail = e instanceof Error ? e.message.slice(0, 500) : "unknown";
      }
    }

    await writeLog({ req, url, resourceType, operation, status: result.status, started, summary: result.summary, ip, body, errorDetail, resourceId: result.resourceId ?? null });
    return scimJson(result.status, result.status === 204 ? undefined : result.body, result.headers);
  };
}

async function writeLog(e: {
  req: Request; url: URL; resourceType: string | null; operation: string; status: number; started: number;
  summary: string; ip: string | null; body: unknown; errorDetail: string | null; resourceId: string | null;
}) {
  try {
    await getDb().insert(scimSyncLogs).values({
      method: e.req.method,
      path: e.url.pathname,
      query: e.url.search ? safeDecode(e.url.search.slice(1)).slice(0, 1000) : null,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      operation: e.operation,
      statusCode: e.status,
      durationMs: Date.now() - e.started,
      summary: e.summary.slice(0, 1000),
      requestBody: e.body === undefined ? null : (redact(e.body) as object),
      errorDetail: e.errorDetail,
      clientIp: e.ip,
      userAgent: e.req.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (err) {
    console.error("[scim] failed to write sync log", err instanceof Error ? err.message : err);
  }
}

/** Parse startIndex/count per RFC 7644 §3.4.2.4. */
export function pagination(url: URL, max: number, def: number) {
  const si = Number(url.searchParams.get("startIndex") ?? "1");
  const c = url.searchParams.get("count");
  const startIndex = Number.isFinite(si) && si >= 1 ? Math.floor(si) : 1;
  let count = c == null ? def : Number(c);
  if (!Number.isFinite(count) || count < 0) count = 0;
  return { startIndex, count: Math.min(Math.floor(count), max) };
}

/** Apply attributes / excludedAttributes projection to top-level attributes. */
export function project(resource: Record<string, unknown>, url: URL): Record<string, unknown> {
  const attrs = url.searchParams.get("attributes");
  const excluded = url.searchParams.get("excludedAttributes");
  const always = new Set(["id", "schemas", "meta"]);
  const norm = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.startsWith("urn:")) {
      const i = t.lastIndexOf(":");
      const head = t.slice(0, i);
      return head.endsWith(":user") || head.endsWith(":group") ? (head.includes("core:2.0") ? t.slice(i + 1).split(".")[0] : head) : t;
    }
    return t.split(".")[0];
  };
  if (attrs) {
    const keep = new Set(attrs.split(",").map(norm));
    return Object.fromEntries(Object.entries(resource).filter(([k]) => always.has(k) || keep.has(k.toLowerCase())));
  }
  if (excluded) {
    const drop = new Set(excluded.split(",").map(norm));
    return Object.fromEntries(Object.entries(resource).filter(([k]) => always.has(k) || !drop.has(k.toLowerCase())));
  }
  return resource;
}

function safeDecode(q: string) {
  try {
    return decodeURIComponent(q.replace(/\+/g, " "));
  } catch {
    return q;
  }
}
