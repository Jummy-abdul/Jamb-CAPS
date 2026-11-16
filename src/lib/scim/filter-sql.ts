import "server-only";
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { ScimError } from "./errors";
import type { CompareOp, FilterNode, Value } from "./filter";

/**
 * Translate a SCIM filter AST into a parameterised SQL condition using an
 * explicit whitelist of filterable attributes. Values are always bound
 * parameters; attribute names never reach SQL text.
 */

export type AttrSpec =
  | { kind: "string"; column: AnyColumn | SQL; caseExact?: boolean }
  | { kind: "boolean"; column: AnyColumn | SQL }
  | { kind: "date"; column: AnyColumn | SQL }
  | { kind: "custom"; build: (op: CompareOp | "pr", value: Value) => SQL };

export type AttrMap = Record<string, AttrSpec>;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function normalizeAttr(attr: string, coreSchema: string) {
  const a = attr.toLowerCase();
  const core = coreSchema.toLowerCase() + ":";
  return a.startsWith(core) ? a.slice(core.length) : a;
}

export function stringCompare(column: AnyColumn | SQL, op: CompareOp | "pr", value: Value, caseExact = false): SQL {
  if (op === "pr") return sql`(${column} is not null and ${column}::text <> '')`;
  if (value === null) return op === "ne" ? sql`${column} is not null` : op === "eq" ? sql`${column} is null` : sql`false`;
  const v = String(value);
  const col = caseExact ? sql`${column}::text` : sql`lower(${column}::text)`;
  const val = caseExact ? v : v.toLowerCase();
  switch (op) {
    case "eq": return sql`${col} = ${val}`;
    case "ne": return sql`(${column} is null or ${col} <> ${val})`;
    case "co": return sql`${col} like ${"%" + escapeLike(val) + "%"}`;
    case "sw": return sql`${col} like ${escapeLike(val) + "%"}`;
    case "ew": return sql`${col} like ${"%" + escapeLike(val)}`;
    case "gt": return sql`${col} > ${val}`;
    case "ge": return sql`${col} >= ${val}`;
    case "lt": return sql`${col} < ${val}`;
    case "le": return sql`${col} <= ${val}`;
  }
}

function compare(spec: AttrSpec, op: CompareOp | "pr", value: Value, attr: string): SQL {
  switch (spec.kind) {
    case "custom":
      return spec.build(op, value);
    case "string":
      return stringCompare(spec.column, op, value, spec.caseExact);
    case "boolean": {
      if (op === "pr") return sql`${spec.column} is not null`;
      const b = typeof value === "string" ? value.toLowerCase() === "true" : value;
      if (typeof b !== "boolean") throw ScimError.invalidFilter(`'${attr}' requires a boolean value`);
      if (op === "eq") return sql`${spec.column} = ${b}`;
      if (op === "ne") return sql`${spec.column} <> ${b}`;
      throw ScimError.invalidFilter(`Operator '${op}' is not supported for boolean attribute '${attr}'`);
    }
    case "date": {
      if (op === "pr") return sql`${spec.column} is not null`;
      const d = typeof value === "string" ? new Date(value) : null;
      if (!d || Number.isNaN(d.getTime())) throw ScimError.invalidFilter(`'${attr}' requires a dateTime value`);
      const iso = d.toISOString();
      const ops: Partial<Record<CompareOp, SQL>> = {
        eq: sql`${spec.column} = ${iso}::timestamptz`, ne: sql`${spec.column} <> ${iso}::timestamptz`,
        gt: sql`${spec.column} > ${iso}::timestamptz`, ge: sql`${spec.column} >= ${iso}::timestamptz`,
        lt: sql`${spec.column} < ${iso}::timestamptz`, le: sql`${spec.column} <= ${iso}::timestamptz`,
      };
      const r = ops[op as CompareOp];
      if (!r) throw ScimError.invalidFilter(`Operator '${op}' is not supported for dateTime attribute '${attr}'`);
      return r;
    }
  }
}

export function filterToSql(node: FilterNode, map: AttrMap, coreSchema: string, prefix = ""): SQL {
  switch (node.type) {
    case "and": return sql`(${filterToSql(node.left, map, coreSchema, prefix)} and ${filterToSql(node.right, map, coreSchema, prefix)})`;
    case "or": return sql`(${filterToSql(node.left, map, coreSchema, prefix)} or ${filterToSql(node.right, map, coreSchema, prefix)})`;
    case "not": return sql`(not ${filterToSql(node.expr, map, coreSchema, prefix)})`;
    case "valuePath": return filterToSql(node.filter, map, coreSchema, `${normalizeAttr(node.attr, coreSchema)}.`);
    case "present":
    case "compare": {
      const key = prefix + normalizeAttr(node.attr, coreSchema);
      const spec = map[key];
      if (!spec) throw ScimError.invalidFilter(`Filtering on '${node.attr}' is not supported`);
      return node.type === "present" ? compare(spec, "pr", null, node.attr) : compare(spec, node.op, node.value, node.attr);
    }
  }
}
