/**
 * Server Manager
 *
 * Manages the lifecycle of the amnesia-server process:
 * - Auto-start when plugin loads
 * - Health monitoring with periodic checks
 * - Auto-restart on crash (up to maxRestartAttempts)
 * - Graceful shutdown when plugin unloads
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { Notice } from 'obsidian';

/**
 * Server manager configuration
 */
export interface ServerManagerConfig {
  /** Port for the server to listen on. Default: 3000 */
  port: number;
  /** Auto-start server when plugin loads. Default: true */
  autoStart: boolean;
  /** Maximum restart attempts before giving up. Default: 3 */
  maxRestartAttempts: number;
  /** Delay between restart attempts in ms. Default: 2000 */
  restartDelay: number;
  /** Health check interval in ms. Default: 30000 */
  healthCheckInterval: number;
  /** Health check timeout in ms. Default: 5000 */
  healthCheckTimeout: number;
  /** Plugin directory path (for finding server binary) */
  pluginDir: string;
  /** Show notices for server events. Default: true */
  showNotices: boolean;
}

/**
 * Server status
 */
export type ServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'restarting';

/**
 * Server state for subscribers
 */
export interface ServerState {
  status: ServerStatus;
  port: number;
  pid?: number;
  uptime?: number;
  restartCount: number;
  lastError?: string;
  lastHealthCheck?: Date;
}

/**
 * Event types for server manager
 */
export type ServerEventType =
  | 'status-change'
  | 'started'
  | 'stopped'
  | 'error'
  | 'restart'
  | 'health-check';

export interface ServerEvent {
  type: ServerEventType;
  state: ServerState;
  message?: string;
}

type ServerEventCallback = (event: ServerEvent) => void;

/**
 * Default configuration
 */
export const DEFAULT_SERVER_CONFIG: ServerManagerConfig = {
  port: 3000,
  autoStart: true,
  maxRestartAttempts: 3,
  restartDelay: 2000,
  healthCheckInterval: 30000,
  healthCheckTimeout: 5000,
  pluginDir: '',
  showNotices: true,
};

/**
 * Server Manager class
 */
export class ServerManager {
  private config: ServerManagerConfig;
  private process: ChildProcess | null = null;
  private status: ServerStatus = 'stopped';
  private restartCount = 0;
  private startTime?: Date;
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private lastError?: string;
  private lastHealthCheck?: Date;
  private subscribers: Set<ServerEventCallback> = new Set();
  private isShuttingDown = false;

  constructor(config: Partial<ServerManagerConfig> = {}) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
  }

  /**
   * Subscribe to server events
   */
  on(callback: ServerEventCallback): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Emit event to all subscribers
   */
  private emit(type: ServerEventType, message?: string): void {
    const event: ServerEvent = {
      type,
      state: this.getState(),
      message,
    };
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (e) {
        console.error('[ServerManager] Subscriber error:', e);
      }
    }
  }

  /**
   * Get current server state
   */
  getState(): ServerState {
    return {
      status: this.status,
      port: this.config.port,
      pid: this.process?.pid,
      uptime: this.startTime
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : undefined,
      restartCount: this.restartCount,
      lastError: this.lastError,
      lastHealthCheck: this.lastHealthCheck,
    };
  }

  /**
   * Get current status
   */
  getStatus(): ServerStatus {
    return this.status;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.status === 'running';
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ServerManagerConfig>): void {
    const portChanged = config.port && config.port !== this.config.port;
    this.config = { ...this.config, ...config };

    // Restart if port changed and server is running
    if (portChanged && this.isRunning()) {
      console.log('[ServerManager] Port changed, restarting server...');
      this.restart();
    }
  }

  /**
   * Initialize and optionally auto-start
   */
  async initialize(): Promise<void> {
    console.log('[ServerManager] Initializing...');

    // Check if server is already running externally
    if (await this.checkHealth()) {
      console.log('[ServerManager] Server already running externally');
      this.setStatus('running');
      this.startHealthMonitoring();
      return;
    }

    // Auto-start if enabled
    if (this.config.autoStart) {
      await this.start();
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<boolean> {
    if (this.status === 'running' || this.status === 'starting') {
      console.log('[ServerManager] Server already running or starting');
      return true;
    }

    this.setStatus('starting');
    this.lastError = undefined;

    // Find server binary
    const serverPath = this.findServerBinary();
    if (!serverPath) {
      this.lastError = 'Server binary not found';
      this.setStatus('error');
      this.emit('error', this.lastError);
      if (this.config.showNotices) {
        new Notice('Amnesia server binary not found. Please install the server.');
      }
      return false;
    }

    console.log('[ServerManager] Starting server from:', serverPath);

    try {
      // Spawn the server process
      this.process = spawn(serverPath, [], {
        env: {
          ...process.env,
          PORT: String(this.config.port),
          RUST_LOG: 'info',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          console.log('[Server]', message);
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          console.error('[Server]', message);
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[ServerManager] Server exited with code ${code}, signal ${signal}`);
        this.handleProcessExit(code, signal);
      });

      // Handle process error
      this.process.on('error', (error) => {
        console.error('[ServerManager] Process error:', error);
        this.lastError = error.message;
        this.setStatus('error');
        this.emit('error', error.message);
      });

      // Wait for server to become healthy
      const healthy = await this.waitForHealth(15000);
      if (healthy) {
        this.setStatus('running');
        this.startTime = new Date();
        this.restartCount = 0;
        this.startHealthMonitoring();
        this.emit('started', `Server started on port ${this.config.port}`);
        if (this.config.showNotices) {
          new Notice(`Amnesia server started on port ${this.config.port}`);
        }
        return true;
      } else {
        this.lastError = 'Server failed to become healthy';
        this.setStatus('error');
        this.emit('error', this.lastError);
        await this.stop();
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = message;
      this.setStatus('error');
      this.emit('error', message);
      console.error('[ServerManager] Failed to start server:', error);
      return false;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'stopping') {
      return;
    }

    this.isShuttingDown = true;
    this.setStatus('stopping');
    this.stopHealthMonitoring();

    if (!this.process) {
      this.setStatus('stopped');
      this.emit('stopped');
      this.isShuttingDown = false;
      return;
    }

    console.log('[ServerManager] Stopping server...');

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        console.log('[ServerManager] Force killing server...');
        this.process?.kill('SIGKILL');
      }, 5000);

      const onExit = () => {
        clearTimeout(timeout);
        this.process = null;
        this.startTime = undefined;
        this.setStatus('stopped');
        this.emit('stopped');
        this.isShuttingDown = false;
        resolve();
      };

      if (this.process) {
        this.process.once('exit', onExit);
        this.process.kill('SIGTERM');
      } else {
        onExit();
      }
    });
  }

  /**
   * Restart the server
   */
  async restart(): Promise<boolean> {
    console.log('[ServerManager] Restarting server...');
    this.setStatus('restarting');
    await this.stop();
    return this.start();
  }

  /**
   * Destroy the manager (cleanup)
   */
  async destroy(): Promise<void> {
    console.log('[ServerManager] Destroying...');
    this.stopHealthMonitoring();
    await this.stop();
    this.subscribers.clear();
  }

  /**
   * Find the server binary in known locations
   */
  private findServerBinary(): string | null {
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = platform === 'win32' ? 'amnesia-server.exe' : 'amnesia-server';

    // Candidate locations (in priority order)
    const candidates: string[] = [];

    if (this.config.pluginDir) {
      // Within plugin directory
      candidates.push(
        path.join(this.config.pluginDir, 'server', binaryName),
        path.join(this.config.pluginDir, 'bin', binaryName),
        path.join(this.config.pluginDir, 'bin', `${platform}-${arch}`, binaryName),
      );
    }

    // Development location (in monorepo)
    const devPath = path.join(
      __dirname,
      '../../../../amnesia-server/target/release',
      binaryName
    );
    candidates.push(devPath);

    // Debug build location
    const debugPath = path.join(
      __dirname,
      '../../../../amnesia-server/target/debug',
      binaryName
    );
    candidates.push(debugPath);

    // Check each candidate
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          console.log('[ServerManager] Found server binary at:', candidate);
          return candidate;
        }
      } catch {
        // Ignore errors checking path
      }
    }

    console.warn('[ServerManager] Server binary not found in:', candidates);
    return null;
  }

  /**
   * Check server health
   */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeout
      );

      const response = await fetch(
        `http://localhost:${this.config.port}/health`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);
      this.lastHealthCheck = new Date();

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait for server to become healthy
   */
  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      if (await this.checkHealth()) {
        return true;
      }
      await this.sleep(checkInterval);
    }

    return false;
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.stopHealthMonitoring();

    this.healthCheckTimer = setInterval(async () => {
      if (this.status !== 'running') return;

      const healthy = await this.checkHealth();
      this.emit('health-check');

      if (!healthy && !this.isShuttingDown) {
        console.warn('[ServerManager] Health check failed');
        this.handleUnhealthyServer();
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = null;
    this.startTime = undefined;
    this.stopHealthMonitoring();

    // Don't restart if we're intentionally shutting down
    if (this.isShuttingDown) {
      return;
    }

    // Unexpected exit - try to restart
    if (code !== 0) {
      this.lastError = `Server crashed with code ${code}, signal ${signal}`;
      console.error('[ServerManager]', this.lastError);
      this.setStatus('error');
      this.emit('error', this.lastError);
      this.attemptRestart();
    } else {
      this.setStatus('stopped');
      this.emit('stopped');
    }
  }

  /**
   * Handle unhealthy server (health check failed)
   */
  private handleUnhealthyServer(): void {
    if (this.isShuttingDown) return;

    console.warn('[ServerManager] Server unhealthy, checking process...');

    // Check if process is still running
    if (this.process && !this.process.killed) {
      // Process is running but not responding - kill and restart
      console.log('[ServerManager] Process running but unresponsive, restarting...');
      this.process.kill('SIGKILL');
      // handleProcessExit will be called and trigger restart
    } else {
      // Process died without our knowledge
      this.attemptRestart();
    }
  }

  /**
   * Attempt to restart the server
   */
  private async attemptRestart(): Promise<void> {
    if (this.isShuttingDown) return;

    this.restartCount++;

    if (this.restartCount > this.config.maxRestartAttempts) {
      console.error(
        `[ServerManager] Max restart attempts (${this.config.maxRestartAttempts}) exceeded`
      );
      this.lastError = 'Max restart attempts exceeded';
      this.setStatus('error');
      this.emit('error', this.lastError);
      if (this.config.showNotices) {
        new Notice(
          `Amnesia server failed to restart after ${this.config.maxRestartAttempts} attempts`
        );
      }
      return;
    }

    console.log(
      `[ServerManager] Attempting restart (${this.restartCount}/${this.config.maxRestartAttempts})...`
    );
    this.setStatus('restarting');
    this.emit('restart', `Restart attempt ${this.restartCount}`);

    await this.sleep(this.config.restartDelay);

    const success = await this.start();
    if (!success && this.restartCount < this.config.maxRestartAttempts) {
      // Start will handle setting status, we just need to retry
      this.attemptRestart();
    }
  }

  /**
   * Set status and emit change event
   */
  private setStatus(status: ServerStatus): void {
    if (this.status !== status) {
      const previousStatus = this.status;
      this.status = status;
      console.log(`[ServerManager] Status: ${previousStatus} → ${status}`);
      this.emit('status-change');
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
