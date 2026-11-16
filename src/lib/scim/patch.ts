/**
 * Generic SCIM 2.0 PATCH engine (RFC 7644 §3.5.2).
 *
 * Applies operations to a JSON representation of a resource. The resulting JSON
 * is then validated and persisted by the resource service exactly like a PUT,
 * which keeps PATCH and PUT semantics consistent.
 *
 * Tolerates common client variations: capitalised op names ("Replace"), operations
 * without a path whose value keys are dotted ("name.givenName") or URN-qualified,
 * and `remove` with a value array for multi-valued attributes (e.g. members).
 */
import { ScimError } from "./errors";
import { evaluate, parseFilter, type FilterNode } from "./filter";

export interface PatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

type Json = Record<string, unknown>;

interface ParsedPath {
  schema?: string;
  attr: string;
  filter?: FilterNode;
  sub?: string;
}

export interface PatchOptions {
  /** Lower-case names of core attributes that are multi-valued. */
  multiValued: Set<string>;
  /** Schema URNs whose attributes live at the top level (the resource's core schema). */
  coreSchemas: string[];
}

function parsePath(path: string, opts: PatchOptions): ParsedPath {
  let p = path.trim();
  let schema: string | undefined;
  if (p.toLowerCase().startsWith("urn:")) {
    const bracket = p.indexOf("[");
    const head = bracket === -1 ? p : p.slice(0, bracket);
    const idx = head.lastIndexOf(":");
    schema = head.slice(0, idx);
    p = p.slice(idx + 1);
    if (opts.coreSchemas.some((c) => c.toLowerCase() === schema!.toLowerCase())) schema = undefined;
  }
  const b = p.indexOf("[");
  if (b !== -1) {
    const e = p.lastIndexOf("]");
    if (e < b) throw ScimError.invalidPath(`Invalid path '${path}'`);
    const attr = p.slice(0, b);
    const filter = parseFilter(p.slice(b + 1, e));
    const rest = p.slice(e + 1);
    const sub = rest.startsWith(".") ? rest.slice(1) : undefined;
    if (rest && !sub) throw ScimError.invalidPath(`Invalid path '${path}'`);
    return { schema, attr, filter, sub };
  }
  const [attr, sub, ...more] = p.split(".");
  if (more.length || !attr) throw ScimError.invalidPath(`Invalid path '${path}'`);
  return { schema, attr, sub };
}

function keyCI(obj: Json, key: string): string {
  return Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
}

function container(resource: Json, schema: string | undefined, create: boolean): Json | undefined {
  if (!schema) return resource;
  const k = keyCI(resource, schema);
  if (resource[k] == null || typeof resource[k] !== "object") {
    if (!create) return undefined;
    resource[k] = {};
  }
  return resource[k] as Json;
}

const isObj = (v: unknown): v is Json => v != null && typeof v === "object" && !Array.isArray(v);

function sameValue(a: unknown, b: unknown) {
  if (isObj(a) && isObj(b) && "value" in a && "value" in b) return String(a.value).toLowerCase() === String(b.value).toLowerCase();
  return JSON.stringify(a) === JSON.stringify(b);
}

function isMulti(attr: string, current: unknown, opts: PatchOptions, schema?: string) {
  return Array.isArray(current) || (!schema && opts.multiValued.has(attr.toLowerCase()));
}

function applyOne(resource: Json, opName: string, path: string | undefined, value: unknown, opts: PatchOptions) {
  const op = opName.toLowerCase();
  if (!["add", "replace", "remove"].includes(op)) throw ScimError.invalidSyntax(`Unsupported PATCH op '${opName}'`);

  if (!path) {
    if (op === "remove") throw ScimError.noTarget("remove operation requires a path");
    if (!isObj(value)) throw ScimError.invalidSyntax(`${opName} without path requires an object value`);
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase() === "schemas") continue;
      // URN-keyed extension object: apply each sub-attribute.
      if (k.toLowerCase().startsWith("urn:") && isObj(v) && !opts.coreSchemas.some((c) => c.toLowerCase() === k.toLowerCase())) {
        for (const [sk, sv] of Object.entries(v)) applyOne(resource, op, `${k}:${sk}`, sv, opts);
      } else if (k.toLowerCase().startsWith("urn:") && isObj(v)) {
        for (const [sk, sv] of Object.entries(v)) applyOne(resource, op, sk, sv, opts);
      } else {
        applyOne(resource, op, k, v, opts);
      }
    }
    return;
  }

  const p = parsePath(path, opts);
  const target = container(resource, p.schema, op !== "remove");
  if (!target) return; // removing from an absent extension: no-op
  const k = keyCI(target, p.attr);
  const current = target[k];

  // ------------------------------------------------ value-path filter: attr[filter](.sub)
  if (p.filter) {
    const arr = Array.isArray(current) ? current : [];
    const matches = arr.filter((el) => evaluate(p.filter!, el));
    if (op === "remove") {
      if (p.sub) matches.forEach((el) => { if (isObj(el)) delete el[keyCI(el, p.sub!)]; });
      else target[k] = arr.filter((el) => !matches.includes(el));
      return;
    }
    if (matches.length === 0) {
      if (op === "add" && p.sub) {
        // Not commonly used; create an element satisfying a simple eq filter, e.g. emails[type eq "work"].value
        const seed: Json = {};
        if (p.filter.type === "compare" && p.filter.op === "eq") seed[p.filter.attr] = p.filter.value;
        seed[p.sub] = value;
        target[k] = [...arr, seed];
        return;
      }
      throw ScimError.noTarget(`No values matched '${path}'`);
    }
    for (const el of matches) {
      if (!isObj(el)) continue;
      if (p.sub) el[keyCI(el, p.sub)] = value;
      else if (isObj(value)) Object.assign(el, value);
    }
    return;
  }

  // ------------------------------------------------ sub-attribute: attr.sub
  if (p.sub) {
    if (Array.isArray(current)) {
      // e.g. "emails.value" without filter → apply to the primary (or first) element
      const el = (current.find((e) => isObj(e) && e.primary === true) ?? current[0]) as Json | undefined;
      if (op === "remove") { if (el) delete el[keyCI(el, p.sub)]; return; }
      if (el) el[keyCI(el, p.sub)] = value;
      else target[k] = [{ [p.sub]: value, primary: true }];
      return;
    }
    if (op === "remove") { if (isObj(current)) delete current[keyCI(current, p.sub)]; return; }
    const obj = isObj(current) ? current : (target[k] = {} as Json);
    (obj as Json)[keyCI(obj as Json, p.sub)] = value;
    return;
  }

  // ------------------------------------------------ plain attribute
  const multi = isMulti(p.attr, current, opts, p.schema);
  if (op === "remove") {
    if (multi && value !== undefined) {
      const toRemove = Array.isArray(value) ? value : [value];
      target[k] = (Array.isArray(current) ? current : []).filter((el) => !toRemove.some((r) => sameValue(el, r)));
    } else {
      delete target[k];
    }
    return;
  }
  if (multi) {
    const incoming = value == null ? [] : Array.isArray(value) ? value : [value];
    if (op === "replace") { target[k] = incoming; return; }
    const out = Array.isArray(current) ? [...current] : [];
    for (const v of incoming) if (!out.some((e) => sameValue(e, v))) out.push(v);
    target[k] = out;
    return;
  }
  // Complex (single-valued) attribute: both add and replace merge the supplied sub-attributes (RFC 7644 §3.5.2.1/3).
  if (isObj(current) && isObj(value)) { Object.assign(current, value); return; }
  target[k] = value;
}

export function applyPatch(resource: Json, body: unknown, opts: PatchOptions): Json {
  if (!isObj(body)) throw ScimError.invalidSyntax("PATCH body must be a JSON object");
  const schemas = body.schemas;
  if (!Array.isArray(schemas) || !schemas.includes(PATCH_SCHEMA)) throw ScimError.invalidSyntax(`PATCH request must declare schema ${PATCH_SCHEMA}`);
  const ops = (body.Operations ?? body.operations) as unknown;
  if (!Array.isArray(ops) || ops.length === 0) throw ScimError.invalidSyntax("PATCH request must contain Operations");
  if (ops.length > 1000) throw ScimError.invalidSyntax("Too many operations");
  const copy = structuredClone(resource);
  for (const o of ops) {
    if (!isObj(o) || typeof o.op !== "string") throw ScimError.invalidSyntax("Each operation requires an 'op'");
    if (o.path !== undefined && typeof o.path !== "string") throw ScimError.invalidPath("path must be a string");
    applyOne(copy, o.op, o.path as string | undefined, o.value, opts);
  }
  return copy;
}
