/**
 * SCIM 2.0 filter parser (RFC 7644 §3.4.2.2).
 *
 *   filter     = orExpr
 *   orExpr     = andExpr *("or" andExpr)
 *   andExpr    = notExpr *("and" notExpr)
 *   notExpr    = "not" "(" filter ")" / primary
 *   primary    = "(" filter ")" / attrPath "pr" / attrPath compareOp compValue / attrPath "[" filter "]"
 *
 * Produces an AST that can be translated to SQL (list queries) or evaluated in
 * memory (PATCH value-path selectors such as members[value eq "…"]).
 */
import { ScimError } from "./errors";

export type CompareOp = "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le";
export type Value = string | number | boolean | null;

export type FilterNode =
  | { type: "compare"; attr: string; op: CompareOp; value: Value }
  | { type: "present"; attr: string }
  | { type: "and"; left: FilterNode; right: FilterNode }
  | { type: "or"; left: FilterNode; right: FilterNode }
  | { type: "not"; expr: FilterNode }
  | { type: "valuePath"; attr: string; filter: FilterNode };

const COMPARE_OPS = new Set(["eq", "ne", "co", "sw", "ew", "gt", "ge", "lt", "le"]);

type Token =
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "lbracket" }
  | { t: "rbracket" }
  | { t: "word"; v: string }
  | { t: "string"; v: string }
  | { t: "number"; v: number };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { tokens.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rparen" }); i++; continue; }
    if (c === "[") { tokens.push({ t: "lbracket" }); i++; continue; }
    if (c === "]") { tokens.push({ t: "rbracket" }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let raw = "";
      while (j < input.length && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < input.length) { raw += input[j] + input[j + 1]; j += 2; continue; }
        raw += input[j++];
      }
      if (j >= input.length) throw ScimError.invalidFilter("Unterminated string literal");
      try {
        tokens.push({ t: "string", v: JSON.parse(`"${raw}"`) });
      } catch {
        throw ScimError.invalidFilter("Invalid string literal");
      }
      i = j + 1;
      continue;
    }
    const m = /^[A-Za-z0-9_:.$\-+]+/.exec(input.slice(i));
    if (!m) throw ScimError.invalidFilter(`Unexpected character '${c}'`);
    const w = m[0];
    if (/^-?\d+(\.\d+)?$/.test(w)) tokens.push({ t: "number", v: Number(w) });
    else tokens.push({ t: "word", v: w });
    i += w.length;
  }
  return tokens;
}

export function parseFilter(input: string): FilterNode {
  if (!input || !input.trim()) throw ScimError.invalidFilter("Empty filter");
  if (input.length > 2000) throw ScimError.invalidFilter("Filter too long");
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = (tok: Token | undefined, w: string) => tok?.t === "word" && tok.v.toLowerCase() === w;

  function parseOr(): FilterNode {
    let left = parseAnd();
    while (isWord(peek(), "or")) { pos++; left = { type: "or", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd(): FilterNode {
    let left = parseNot();
    while (isWord(peek(), "and")) { pos++; left = { type: "and", left, right: parseNot() }; }
    return left;
  }
  function parseNot(): FilterNode {
    if (isWord(peek(), "not")) {
      pos++;
      if (peek()?.t !== "lparen") throw ScimError.invalidFilter("Expected '(' after not");
      pos++;
      const expr = parseOr();
      if (peek()?.t !== "rparen") throw ScimError.invalidFilter("Expected ')'");
      pos++;
      return { type: "not", expr };
    }
    return parsePrimary();
  }
  function parsePrimary(): FilterNode {
    const tok = peek();
    if (!tok) throw ScimError.invalidFilter("Unexpected end of filter");
    if (tok.t === "lparen") {
      pos++;
      const e = parseOr();
      if (peek()?.t !== "rparen") throw ScimError.invalidFilter("Expected ')'");
      pos++;
      return e;
    }
    if (tok.t !== "word") throw ScimError.invalidFilter("Expected attribute path");
    pos++;
    const attr = tok.v;
    const next = peek();
    if (next?.t === "lbracket") {
      pos++;
      const inner = parseOr();
      if (peek()?.t !== "rbracket") throw ScimError.invalidFilter("Expected ']'");
      pos++;
      return { type: "valuePath", attr, filter: inner };
    }
    if (isWord(next, "pr")) { pos++; return { type: "present", attr }; }
    if (next?.t !== "word" || !COMPARE_OPS.has(next.v.toLowerCase())) throw ScimError.invalidFilter(`Expected operator after '${attr}'`);
    pos++;
    const op = next.v.toLowerCase() as CompareOp;
    const vt = peek();
    pos++;
    let value: Value;
    if (vt?.t === "string") value = vt.v;
    else if (vt?.t === "number") value = vt.v;
    else if (vt?.t === "word" && ["true", "false", "null"].includes(vt.v.toLowerCase())) value = vt.v.toLowerCase() === "null" ? null : vt.v.toLowerCase() === "true";
    else throw ScimError.invalidFilter(`Invalid comparison value for '${attr}'`);
    return { type: "compare", attr, op, value };
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw ScimError.invalidFilter("Unexpected trailing tokens in filter");
  return ast;
}

/** Split "urn:...:User:name.givenName" → { schema, path: "name.givenName" }. */
export function splitAttrPath(attr: string): { schema?: string; path: string } {
  if (attr.toLowerCase().startsWith("urn:")) {
    const idx = attr.lastIndexOf(":");
    return { schema: attr.slice(0, idx), path: attr.slice(idx + 1) };
  }
  return { path: attr };
}

/* ---------------------------------------------------------------- in-memory evaluation */

function getCI(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  const k = Object.keys(obj as object).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : (obj as Record<string, unknown>)[k];
}

function resolve(obj: unknown, attr: string): unknown[] {
  const { schema, path } = splitAttrPath(attr);
  let cur: unknown = schema ? getCI(obj, schema) ?? obj : obj;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur.map((c) => getCI(c, part)).flat();
    else cur = getCI(cur, part);
  }
  if (cur === undefined || cur === null) return [];
  return Array.isArray(cur) ? cur : [cur];
}

function cmp(a: unknown, op: CompareOp, b: Value): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") {
    const av = typeof a === "string" ? a.toLowerCase() === "true" : a;
    if (op === "eq") return av === b;
    if (op === "ne") return av !== b;
    return false;
  }
  if (b === null) return op === "ne" ? a != null : a == null;
  const as = String(a).toLowerCase();
  const bs = String(b).toLowerCase();
  switch (op) {
    case "eq": return as === bs;
    case "ne": return as !== bs;
    case "co": return as.includes(bs);
    case "sw": return as.startsWith(bs);
    case "ew": return as.endsWith(bs);
    case "gt": return typeof b === "number" ? Number(a) > b : as > bs;
    case "ge": return typeof b === "number" ? Number(a) >= b : as >= bs;
    case "lt": return typeof b === "number" ? Number(a) < b : as < bs;
    case "le": return typeof b === "number" ? Number(a) <= b : as <= bs;
  }
}

/** Evaluate a filter against a JSON object (case-insensitive attribute names, case-insensitive strings). */
export function evaluate(node: FilterNode, obj: unknown): boolean {
  switch (node.type) {
    case "and": return evaluate(node.left, obj) && evaluate(node.right, obj);
    case "or": return evaluate(node.left, obj) || evaluate(node.right, obj);
    case "not": return !evaluate(node.expr, obj);
    case "present": return resolve(obj, node.attr).some((v) => v !== "" && !(Array.isArray(v) && v.length === 0));
    case "compare": {
      const vals = resolve(obj, node.attr);
      if (node.op === "ne") return vals.length === 0 ? node.value !== null : vals.every((v) => cmp(v, "ne", node.value));
      return vals.some((v) => cmp(v, node.op, node.value));
    }
    case "valuePath": return resolve(obj, node.attr).some((el) => evaluate(node.filter, el));
  }
}
