import { SCHEMA_ENTERPRISE_USER, SCHEMA_GROUP, SCHEMA_LIST, SCHEMA_RESOURCE_TYPE, SCHEMA_SCHEMA, SCHEMA_SPC, SCHEMA_USER, MAX_PAGE_SIZE } from "./constants";

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: [SCHEMA_SPC],
    documentationUri: `${baseUrl.replace(/\/scim\/v2$/, "")}/settings`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE_SIZE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      { type: "oauthbearertoken", name: "Bearer Token", description: "Authentication using a static bearer token issued for Fixiam provisioning", primary: true },
    ],
    meta: { resourceType: "ServiceProviderConfig", location: `${baseUrl}/ServiceProviderConfig` },
  };
}

export function resourceTypes(baseUrl: string) {
  const list = [
    { schemas: [SCHEMA_RESOURCE_TYPE], id: "User", name: "User", endpoint: "/Users", description: "CAPS user account", schema: SCHEMA_USER,
      schemaExtensions: [{ schema: SCHEMA_ENTERPRISE_USER, required: false }], meta: { resourceType: "ResourceType", location: `${baseUrl}/ResourceTypes/User` } },
    { schemas: [SCHEMA_RESOURCE_TYPE], id: "Group", name: "Group", endpoint: "/Groups", description: "CAPS group (mapped to application roles)", schema: SCHEMA_GROUP,
      meta: { resourceType: "ResourceType", location: `${baseUrl}/ResourceTypes/Group` } },
  ];
  return { schemas: [SCHEMA_LIST], totalResults: list.length, startIndex: 1, itemsPerPage: list.length, Resources: list };
}

const a = (name: string, extra: Record<string, unknown> = {}) => ({
  name, type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none", ...extra,
});

export function schemas(baseUrl: string) {
  const list = [
    {
      schemas: [SCHEMA_SCHEMA], id: SCHEMA_USER, name: "User", description: "User Account",
      attributes: [
        a("userName", { required: true, uniqueness: "server" }),
        a("name", { type: "complex", subAttributes: [a("givenName"), a("familyName"), a("formatted")] }),
        a("displayName"),
        a("title"),
        a("active", { type: "boolean" }),
        a("emails", { type: "complex", multiValued: true, subAttributes: [a("value"), a("type"), a("primary", { type: "boolean" })] }),
        a("groups", { type: "complex", multiValued: true, mutability: "readOnly", subAttributes: [a("value", { mutability: "readOnly" }), a("display", { mutability: "readOnly" })] }),
      ],
      meta: { resourceType: "Schema", location: `${baseUrl}/Schemas/${SCHEMA_USER}` },
    },
    {
      schemas: [SCHEMA_SCHEMA], id: SCHEMA_ENTERPRISE_USER, name: "EnterpriseUser", description: "Enterprise User",
      attributes: [a("department"), a("employeeNumber"), a("organization"), a("division")],
      meta: { resourceType: "Schema", location: `${baseUrl}/Schemas/${SCHEMA_ENTERPRISE_USER}` },
    },
    {
      schemas: [SCHEMA_SCHEMA], id: SCHEMA_GROUP, name: "Group", description: "Group",
      attributes: [
        a("displayName", { required: true, uniqueness: "server" }),
        a("members", { type: "complex", multiValued: true, subAttributes: [a("value", { mutability: "immutable" }), a("display", { mutability: "readOnly" }), a("type", { mutability: "immutable" })] }),
      ],
      meta: { resourceType: "Schema", location: `${baseUrl}/Schemas/${SCHEMA_GROUP}` },
    },
  ];
  return { schemas: [SCHEMA_LIST], totalResults: list.length, startIndex: 1, itemsPerPage: list.length, Resources: list };
}
