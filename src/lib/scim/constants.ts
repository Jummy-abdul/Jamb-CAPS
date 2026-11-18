export const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCHEMA_ENTERPRISE_USER = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
/** Fixiam authorization extension carrying application-role assignments (`appRoles`). */
export const SCHEMA_FIXIAM_AUTHZ = "urn:fixiam:params:scim:schemas:extension:authorization:2.0:User";
export const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCHEMA_SPC = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
export const SCHEMA_RESOURCE_TYPE = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
export const SCHEMA_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Schema";

export const SCIM_CONTENT_TYPE = "application/scim+json";
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 100;

/** Multi-valued attributes of the core User schema (lower case). */
export const USER_MULTI_VALUED = new Set(["emails", "phonenumbers", "ims", "photos", "addresses", "groups", "entitlements", "roles", "x509certificates"]);
export const GROUP_MULTI_VALUED = new Set(["members"]);
