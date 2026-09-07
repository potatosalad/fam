export interface FamilySearchUser {
  id: string;
  personId?: string;
  treeUserId?: string;
  displayName?: string;
  contactName?: string;
  givenName?: string;
  familyName?: string;
  preferredLanguage?: string;
  [key: string]: unknown;
}
export interface Person {
  id: string;
  living?: boolean;
  display?: { name?: string; gender?: string; lifespan?: string; ascendancyNumber?: string; [key: string]: unknown };
  names?: Array<{ nameForms?: Array<{ fullText?: string }>; [key: string]: unknown }>;
  facts?: Array<{ type?: string; date?: { original?: string }; place?: { original?: string }; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface GedcomX {
  persons?: Person[];
  relationships?: Array<{ id?: string; type?: string; person1?: { resourceId?: string }; person2?: { resourceId?: string }; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface MobileLogin {
  user: FamilySearchUser;
  access_token?: string;
  refresh_token?: string;
  scopes?: Record<string, unknown>;
  [key: string]: unknown;
}
/** Mobile DTOs are still being mapped; preserve unknown fields without asserting their shape. */
export type MobileDocument = Record<string, unknown>;
