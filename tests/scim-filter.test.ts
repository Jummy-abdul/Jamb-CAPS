import { describe, expect, it } from "vitest";
import { evaluate, parseFilter } from "@/lib/scim/filter";
import { ScimError } from "@/lib/scim/errors";

describe("SCIM filter parser", () => {
  it("parses a simple equality filter", () => {
    expect(parseFilter('userName eq "amina@example.com"')).toEqual({ type: "compare", attr: "userName", op: "eq", value: "amina@example.com" });
  });
  it("respects precedence of and/or/not and parentheses", () => {
    const ast = parseFilter('title pr and (emails.value co "@x.ng" or not (active eq false))');
    expect(ast.type).toBe("and");
  });
  it("parses value paths and URN attributes", () => {
    expect(parseFilter('emails[type eq "work" and value ew ".ng"]').type).toBe("valuePath");
    expect(parseFilter('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "ICT"')).toMatchObject({ attr: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department" });
  });
  it("handles escaped strings", () => {
    expect(parseFilter('displayName eq "O\\"Brien"')).toMatchObject({ value: 'O"Brien' });
  });
  it("rejects malformed filters with invalidFilter", () => {
    for (const f of ['userName eq', 'userName foo "x"', '(userName eq "x"', 'userName eq "x" extra', '']) {
      try {
        parseFilter(f);
        throw new Error("expected failure: " + f);
      } catch (e) {
        expect(e).toBeInstanceOf(ScimError);
        expect((e as ScimError).scimType).toBe("invalidFilter");
      }
    }
  });
  it("evaluates in memory, case-insensitively", () => {
    const obj = { userName: "Amina", emails: [{ value: "a@x.ng", type: "work" }], active: true };
    expect(evaluate(parseFilter('USERNAME eq "amina"'), obj)).toBe(true);
    expect(evaluate(parseFilter('emails[type eq "work"]'), obj)).toBe(true);
    expect(evaluate(parseFilter('emails.value sw "a@"'), obj)).toBe(true);
    expect(evaluate(parseFilter('active eq false'), obj)).toBe(false);
    expect(evaluate(parseFilter('title pr'), obj)).toBe(false);
  });
});
