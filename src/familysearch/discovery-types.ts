export interface DiscoveryMetadata {
  /** Optional string headers accepted by fam in addition to APK parameters. */
  commonHeaders: Record<string, string>;
  groups: Record<string, string>;
  operations: Record<string, {
    description: string;
    effect: 'read' | 'write';
    example?: Record<string, unknown>;
    limitations?: string[];
  }>;
}
