/**
 * Reading progress types for sync between devices
 */

export interface ReadingProgress {
  bookId: string;
  userId?: string;
  percent: number;
  cfi: string;
  page?: number;
  totalPages?: number;
  lastRead: Date;
  deviceId?: string;
}

export interface ProgressSyncRequest {
  bookId: string;
  progress: {
    percent: number;
    cfi: string;
    page?: number;
    totalPages?: number;
  };
  timestamp: string;
  deviceId?: string;
}

export interface ProgressSyncResponse {
  bookId: string;
  progress: ReadingProgress;
  conflict?: ProgressConflict;
}

export interface ProgressConflict {
  serverProgress: ReadingProgress;
  clientProgress: ReadingProgress;
  resolution: 'server' | 'client' | 'merge';
}

/**
 * Reading session tracking
 */
export interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: Date;
  endedAt?: Date;
  startCfi: string;
  endCfi?: string;
  startPercent: number;
  endPercent?: number;
  pagesRead?: number;
  wordsRead?: number;
  duration?: number; // in seconds
}

/**
 * Reading statistics
 */
export interface ReadingStats {
  bookId: string;
  totalReadingTime: number; // in seconds
  sessionsCount: number;
  averageSessionLength: number;
  averagePagesPerSession: number;
  lastSessionDate?: Date;
  streakDays: number;
}

/**
 * Sync queue for offline support
 */
export interface SyncQueueItem {
  id: string;
  type: 'progress' | 'highlight' | 'session';
  bookId: string;
  data: unknown;
  timestamp: Date;
  retryCount: number;
}

export interface SyncStatus {
  lastSyncAt?: Date;
  pendingItems: number;
  syncInProgress: boolean;
  lastError?: string;
}
