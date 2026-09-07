import type { HttpMethod } from './transport-types.js';
export type WireType = { kind: 'string' | 'number' | 'integer' | 'boolean' | 'void' | 'json' | 'binary' | 'upload' }
  | { kind: 'ref'; name: string } | { kind: 'array'; items: WireType } | { kind: 'record'; values: WireType };
export interface WireField { type: WireType; required: boolean; nullable: boolean }
export interface WireParameter { kind: string; name: string; type: WireType; required: boolean; encodedInApk: boolean }
export interface OperationContract {
  name: string; method: HttpMethod; path: string; parameters: WireParameter[];
  response: WireType; staticHeaders: string[];
  responseOptional?: boolean;
  responseNote?: string;
  defaultHeaders?: Record<string, string>;
}
export interface ContractData {
  operations: Record<string, OperationContract>;
  models: Record<string, Record<string, WireField>>;
}
