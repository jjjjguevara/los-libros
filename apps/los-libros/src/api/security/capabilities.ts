/**
 * Capability-Based Security System
 * @module api/security/capabilities
 */

import type { Capability } from '../types';
import { PermissionError } from '../types';

/**
 * Capability hierarchy - higher capabilities include lower ones
 */
const CAPABILITY_HIERARCHY: Record<Capability, Capability[]> = {
  'admin': ['write-library', 'write-bookmarks', 'write-annotations', 'read-state'],
  'write-library': ['read-state'],
  'write-bookmarks': ['read-state'],
  'write-annotations': ['read-state'],
  'read-state': []
};

/**
 * Expand a list of capabilities to include implied capabilities
 */
export function expandCapabilities(capabilities: Capability[]): Set<Capability> {
  const expanded = new Set<Capability>();

  function expand(cap: Capability) {
    if (expanded.has(cap)) return;
    expanded.add(cap);
    for (const implied of CAPABILITY_HIERARCHY[cap]) {
      expand(implied);
    }
  }

  for (const cap of capabilities) {
    expand(cap);
  }

  return expanded;
}

/**
 * Check if a set of capabilities includes a required capability
 */
export function hasCapability(
  granted: Set<Capability>,
  required: Capability
): boolean {
  return granted.has(required);
}

/**
 * Require a capability, throwing if not granted
 */
export function requireCapability(
  granted: Set<Capability>,
  required: Capability,
  operation: string
): void {
  if (!hasCapability(granted, required)) {
    throw new PermissionError(required, operation);
  }
}

/**
 * Connection info for a connected plugin
 */
export interface ConnectionInfo {
  pluginId: string;
  capabilities: Set<Capability>;
  connectedAt: Date;
}

/**
 * Connection registry for tracking connected plugins
 */
export class ConnectionRegistry {
  private connections: Map<string, ConnectionInfo> = new Map();

  /**
   * Register a connection
   */
  connect(pluginId: string, capabilities: Capability[]): ConnectionInfo {
    const expanded = expandCapabilities(capabilities);
    const info: ConnectionInfo = {
      pluginId,
      capabilities: expanded,
      connectedAt: new Date()
    };
    this.connections.set(pluginId, info);
    console.log(`[Los Libros] Plugin '${pluginId}' connected with capabilities:`,
      Array.from(expanded));
    return info;
  }

  /**
   * Disconnect a plugin
   */
  disconnect(pluginId: string): boolean {
    const existed = this.connections.delete(pluginId);
    if (existed) {
      console.log(`[Los Libros] Plugin '${pluginId}' disconnected`);
    }
    return existed;
  }

  /**
   * Get connection info for a plugin
   */
  getConnection(pluginId: string): ConnectionInfo | undefined {
    return this.connections.get(pluginId);
  }

  /**
   * Check if a plugin is connected
   */
  isConnected(pluginId: string): boolean {
    return this.connections.has(pluginId);
  }

  /**
   * Get all connected plugins
   */
  getConnectedPlugins(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Clear all connections
   */
  clear(): void {
    this.connections.clear();
  }
}

/**
 * Create a capability checker for a set of granted capabilities
 */
export function createCapabilityChecker(granted: Set<Capability>) {
  return {
    has: (cap: Capability) => hasCapability(granted, cap),
    require: (cap: Capability, operation: string) =>
      requireCapability(granted, cap, operation),
    getGranted: () => new Set(granted)
  };
}

/**
 * Decorator-like function to check capability before executing
 */
export function withCapability<TArgs extends unknown[], TResult>(
  granted: Set<Capability>,
  required: Capability,
  operation: string,
  fn: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    requireCapability(granted, required, operation);
    return fn(...args);
  };
}

/**
 * Async version of withCapability
 */
export function withCapabilityAsync<TArgs extends unknown[], TResult>(
  granted: Set<Capability>,
  required: Capability,
  operation: string,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    requireCapability(granted, required, operation);
    return fn(...args);
  };
}
