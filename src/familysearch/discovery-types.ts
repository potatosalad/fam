export interface DiscoveryMetadata {
  groups: Record<string, string>;
  operations: Record<string, {
    description: string;
    effect: 'read' | 'write';
    example?: Record<string, unknown>;
    limitations?: string[];
  }>;
}
