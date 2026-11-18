/** SCIM 2.0 error responses (RFC 7644 §3.12). */
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export type ScimType =
  | "invalidFilter"
  | "tooMany"
  | "uniqueness"
  | "mutability"
  | "invalidSyntax"
  | "invalidPath"
  | "noTarget"
  | "invalidValue"
  | "invalidVers"
  | "sensitive";

export class ScimError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly scimType?: ScimType,
  ) {
    super(detail);
    this.name = "ScimError";
  }

  static invalidFilter(detail: string) { return new ScimError(400, detail, "invalidFilter"); }
  static invalidSyntax(detail: string) { return new ScimError(400, detail, "invalidSyntax"); }
  static invalidValue(detail: string) { return new ScimError(400, detail, "invalidValue"); }
  static invalidPath(detail: string) { return new ScimError(400, detail, "invalidPath"); }
  static noTarget(detail: string) { return new ScimError(400, detail, "noTarget"); }
  static mutability(detail: string) { return new ScimError(400, detail, "mutability"); }
  static uniqueness(detail: string) { return new ScimError(409, detail, "uniqueness"); }
  static notFound(detail = "Resource not found") { return new ScimError(404, detail); }

  toJSON() {
    return { schemas: [ERROR_SCHEMA], status: String(this.status), ...(this.scimType ? { scimType: this.scimType } : {}), detail: this.detail };
  }
}
