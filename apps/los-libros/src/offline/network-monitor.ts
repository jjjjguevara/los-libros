/**
 * Network Monitor
 *
 * Monitors network connectivity status and provides reactive updates
 * for the application to adapt its behavior accordingly.
 *
 * Features:
 * - Online/offline detection
 * - Connection quality estimation
 * - Server availability checks
 * - Event-based notifications
 * - Automatic reconnection detection
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Network status
 */
export type NetworkStatus = 'online' | 'offline' | 'checking';

/**
 * Connection quality
 */
export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'none';

/**
 * Server availability status
 */
export interface ServerStatus {
  /** Whether server is reachable */
  available: boolean;
  /** Response time in ms */
  latency: number;
  /** Last check timestamp */
  lastCheck: number;
  /** Error message if unavailable */
  error?: string;
}

/**
 * Network state
 */
export interface NetworkState {
  /** Current network status */
  status: NetworkStatus;
  /** Connection quality */
  quality: ConnectionQuality;
  /** Server availability */
  server: ServerStatus;
  /** Whether we're in offline-first mode */
  offlineMode: boolean;
  /** Last state change timestamp */
  lastChange: number;
}

/**
 * Network events
 */
export interface NetworkEvents {
  'online': { previousStatus: NetworkStatus };
  'offline': { previousStatus: NetworkStatus };
  'quality-change': { quality: ConnectionQuality; previous: ConnectionQuality };
  'server-available': { latency: number };
  'server-unavailable': { error: string };
  'state-change': { state: NetworkState; previous: NetworkState };
}

/**
 * Event listener type
 */
export type NetworkEventListener<K extends keyof NetworkEvents> = (
  data: NetworkEvents[K]
) => void;

/**
 * Network monitor configuration
 */
export interface NetworkMonitorConfig {
  /** Server health check URL */
  serverUrl: string;
  /** Health check interval in ms */
  checkInterval: number;
  /** Health check timeout in ms */
  checkTimeout: number;
  /** Number of failed checks before marking offline */
  failureThreshold: number;
  /** Enable automatic health checks */
  autoCheck: boolean;
  /** Latency thresholds for quality estimation */
  latencyThresholds: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_NETWORK_CONFIG: NetworkMonitorConfig = {
  serverUrl: '/api/health',
  checkInterval: 30000, // 30 seconds
  checkTimeout: 5000, // 5 seconds
  failureThreshold: 3,
  autoCheck: true,
  latencyThresholds: {
    excellent: 50,
    good: 150,
    fair: 300,
    poor: 1000,
  },
};

// ============================================================================
// Network Monitor
// ============================================================================

export class NetworkMonitor {
  private config: NetworkMonitorConfig;
  private state: NetworkState;
  private listeners: Map<keyof NetworkEvents, Set<NetworkEventListener<any>>> = new Map();
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures: number = 0;
  private boundOnline: () => void;
  private boundOffline: () => void;

  constructor(config: Partial<NetworkMonitorConfig> = {}) {
    this.config = { ...DEFAULT_NETWORK_CONFIG, ...config };

    // Initialize state
    this.state = {
      status: navigator.onLine ? 'online' : 'offline',
      quality: 'good',
      server: {
        available: false,
        latency: 0,
        lastCheck: 0,
      },
      offlineMode: false,
      lastChange: Date.now(),
    };

    // Bind event handlers
    this.boundOnline = this.handleOnline.bind(this);
    this.boundOffline = this.handleOffline.bind(this);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start monitoring
   */
  start(): void {
    // Listen to browser online/offline events
    window.addEventListener('online', this.boundOnline);
    window.addEventListener('offline', this.boundOffline);

    // Start periodic health checks
    if (this.config.autoCheck) {
      this.startHealthChecks();
    }

    // Initial check
    this.checkServerHealth();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    window.removeEventListener('online', this.boundOnline);
    window.removeEventListener('offline', this.boundOffline);

    this.stopHealthChecks();
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.checkIntervalId) return;

    this.checkIntervalId = setInterval(() => {
      this.checkServerHealth();
    }, this.config.checkInterval);
  }

  /**
   * Stop periodic health checks
   */
  private stopHealthChecks(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }

  // ==========================================================================
  // State
  // ==========================================================================

  /**
   * Get current state
   */
  getState(): NetworkState {
    return { ...this.state };
  }

  /**
   * Check if online
   */
  isOnline(): boolean {
    return this.state.status === 'online';
  }

  /**
   * Check if server is available
   */
  isServerAvailable(): boolean {
    return this.state.server.available;
  }

  /**
   * Check if in offline mode
   */
  isOfflineMode(): boolean {
    return this.state.offlineMode;
  }

  /**
   * Set offline mode manually
   */
  setOfflineMode(enabled: boolean): void {
    if (this.state.offlineMode === enabled) return;

    const previous = { ...this.state };
    this.state.offlineMode = enabled;
    this.state.lastChange = Date.now();

    this.emit('state-change', { state: this.getState(), previous });
  }

  // ==========================================================================
  // Health Checks
  // ==========================================================================

  /**
   * Check server health
   */
  async checkServerHealth(): Promise<ServerStatus> {
    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.checkTimeout
      );

      const response = await fetch(this.config.serverUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = performance.now() - startTime;
      const available = response.ok;

      if (available) {
        this.consecutiveFailures = 0;
        this.updateServerStatus(true, latency);
        this.updateQuality(latency);
      } else {
        this.handleServerFailure(`HTTP ${response.status}`);
      }

      return this.state.server;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.handleServerFailure(errorMessage);
      return this.state.server;
    }
  }

  /**
   * Handle server failure
   */
  private handleServerFailure(error: string): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.updateServerStatus(false, 0, error);
    }
  }

  /**
   * Update server status
   */
  private updateServerStatus(
    available: boolean,
    latency: number,
    error?: string
  ): void {
    const wasAvailable = this.state.server.available;

    this.state.server = {
      available,
      latency,
      lastCheck: Date.now(),
      error,
    };

    if (available && !wasAvailable) {
      this.emit('server-available', { latency });
    } else if (!available && wasAvailable) {
      this.emit('server-unavailable', { error: error || 'Unknown error' });
    }
  }

  /**
   * Update connection quality based on latency
   */
  private updateQuality(latency: number): void {
    const thresholds = this.config.latencyThresholds;
    let quality: ConnectionQuality;

    if (latency <= thresholds.excellent) {
      quality = 'excellent';
    } else if (latency <= thresholds.good) {
      quality = 'good';
    } else if (latency <= thresholds.fair) {
      quality = 'fair';
    } else if (latency <= thresholds.poor) {
      quality = 'poor';
    } else {
      quality = 'none';
    }

    if (quality !== this.state.quality) {
      const previous = this.state.quality;
      this.state.quality = quality;
      this.emit('quality-change', { quality, previous });
    }
  }

  // ==========================================================================
  // Browser Events
  // ==========================================================================

  /**
   * Handle browser online event
   */
  private handleOnline(): void {
    const previousStatus = this.state.status;

    if (previousStatus !== 'online') {
      const previous = { ...this.state };
      this.state.status = 'online';
      this.state.lastChange = Date.now();

      this.emit('online', { previousStatus });
      this.emit('state-change', { state: this.getState(), previous });

      // Check server availability
      this.checkServerHealth();
    }
  }

  /**
   * Handle browser offline event
   */
  private handleOffline(): void {
    const previousStatus = this.state.status;

    if (previousStatus !== 'offline') {
      const previous = { ...this.state };
      this.state.status = 'offline';
      this.state.quality = 'none';
      this.state.server.available = false;
      this.state.lastChange = Date.now();

      this.emit('offline', { previousStatus });
      this.emit('state-change', { state: this.getState(), previous });
    }
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends keyof NetworkEvents>(
    event: K,
    listener: NetworkEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof NetworkEvents>(
    event: K,
    listener: NetworkEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof NetworkEvents>(
    event: K,
    data: NetworkEvents[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[NetworkMonitor] Error in ${event} handler:`, error);
        }
      }
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Wait for online status
   */
  waitForOnline(timeout?: number): Promise<void> {
    if (this.isOnline()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = this.on('online', () => {
        cleanup();
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout waiting for online status'));
        }, timeout);
      }
    });
  }

  /**
   * Wait for server availability
   */
  waitForServer(timeout?: number): Promise<void> {
    if (this.isServerAvailable()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = this.on('server-available', () => {
        cleanup();
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout waiting for server'));
        }, timeout);
      }

      // Trigger a check
      this.checkServerHealth();
    });
  }

  /**
   * Get connection info from Network Information API (if available)
   */
  getConnectionInfo(): {
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  } | null {
    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

    if (!connection) return null;

    return {
      type: connection.type,
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

let monitorInstance: NetworkMonitor | null = null;

/**
 * Get or create the network monitor singleton
 */
export function getNetworkMonitor(
  config?: Partial<NetworkMonitorConfig>
): NetworkMonitor {
  if (!monitorInstance) {
    monitorInstance = new NetworkMonitor(config);
  }
  return monitorInstance;
}

/**
 * Create a new network monitor instance
 */
export function createNetworkMonitor(
  config?: Partial<NetworkMonitorConfig>
): NetworkMonitor {
  return new NetworkMonitor(config);
}
