/**
 * SQLite database operations for Todoist Autolabel Service
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  Config,
  TaskRecord,
  TaskStatus,
  ErrorLogRecord,
  SyncState,
  TaskId,
  Result,
} from './types.js';
import { ok, err, asTaskId } from './types.js';
import { getLogger } from './logger.js';

/**
 * Database manager class
 */
export class DatabaseManager {
  private db: Database.Database;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Ensure the data directory exists
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000');
    this.db.pragma('temp_store = memory');

    // Initialize schema
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    const logger = getLogger();

    // Create sync_state table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        labels TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        classified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create error_logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_error_logs_task_id ON error_logs(task_id);
    `);

    logger.debug('Database schema initialized');
  }

  // ============================================
  // Sync State Operations
  // ============================================

  /**
   * Get sync state
   */
  getSyncState(): SyncState {
    const stmt = this.db.prepare('SELECT key, value FROM sync_state');
    const rows = stmt.all() as { key: string; value: string }[];

    const state: SyncState = {
      syncToken: null,
      lastSyncAt: null,
      inboxProjectId: null,
    };

    for (const row of rows) {
      if (row.key === 'sync_token') state.syncToken = row.value;
      else if (row.key === 'last_sync_at') state.lastSyncAt = row.value;
      else if (row.key === 'inbox_project_id') state.inboxProjectId = row.value;
    }

    return state;
  }

  /**
   * Save sync token
   */
  saveSyncToken(token: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('sync_token', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);
    stmt.run(token);
  }

  /**
   * Save last sync time
   */
  saveLastSyncAt(): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('last_sync_at', datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = datetime('now'),
        updated_at = datetime('now')
    `);
    stmt.run();
  }

  /**
   * Save inbox project ID
   */
  saveInboxProjectId(projectId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('inbox_project_id', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);
    stmt.run(projectId);
  }

  // ============================================
  // Task Operations
  // ============================================

  /**
   * Get task by ID
   */
  getTask(taskId: TaskId): Result<TaskRecord, 'not_found'> {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?');
    const row = stmt.get(taskId);

    if (!row || typeof row !== 'object') {
      return err('not_found');
    }

    return ok(this.mapTaskRow(row as Record<string, unknown>));
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): TaskRecord[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE status = ?');
    const rows = stmt.all(status) as Record<string, unknown>[];
    return rows.map((row) => this.mapTaskRow(row));
  }

  /**
   * Get pending tasks that can be retried (attempts < 3)
   */
  getPendingRetryableTasks(): TaskRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE status = 'pending' AND attempts < 3
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.mapTaskRow(row));
  }

  /**
   * Create or update a task record
   */
  upsertTask(taskId: string, content: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (task_id, content, status, attempts, created_at, updated_at)
      VALUES (?, ?, 'pending', 0, datetime('now'), datetime('now'))
      ON CONFLICT(task_id) DO UPDATE SET
        content = excluded.content,
        updated_at = datetime('now')
    `);
    stmt.run(taskId, content);
  }

  /**
   * Mark task as classified
   */
  markTaskClassified(taskId: string, labels: string[]): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        status = 'classified',
        labels = ?,
        classified_at = datetime('now'),
        updated_at = datetime('now')
      WHERE task_id = ?
    `);
    stmt.run(JSON.stringify(labels), taskId);
  }

  /**
   * Mark task as failed (increments attempt counter)
   */
  markTaskAttempted(taskId: string): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        attempts = attempts + 1,
        last_attempt_at = datetime('now'),
        updated_at = datetime('now')
      WHERE task_id = ?
    `);
    stmt.run(taskId);
  }

  /**
   * Mark task as permanently failed
   */
  markTaskFailed(taskId: string): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        status = 'failed',
        updated_at = datetime('now')
      WHERE task_id = ?
    `);
    stmt.run(taskId);
  }

  /**
   * Mark task as skipped (e.g., already has labels)
   */
  markTaskSkipped(taskId: string): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        status = 'skipped',
        updated_at = datetime('now')
      WHERE task_id = ?
    `);
    stmt.run(taskId);
  }

  /**
   * Check if task needs classification
   */
  taskNeedsClassification(taskId: string): boolean {
    const task = this.getTask(asTaskId(taskId));
    if (!task.success) return true;
    return task.data.status === 'pending' && task.data.attempts < 3;
  }

  /**
   * Map a database row to TaskRecord
   */
  private mapTaskRow(row: Record<string, unknown>): TaskRecord {
    return {
      taskId: row.task_id as string,
      content: row.content as string,
      status: row.status as TaskStatus,
      labels: row.labels as string | null,
      attempts: row.attempts as number,
      lastAttemptAt: row.last_attempt_at as string | null,
      classifiedAt: row.classified_at as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ============================================
  // Error Log Operations
  // ============================================

  /**
   * Log an error
   */
  logError(
    errorType: string,
    errorMessage: string,
    taskId?: string,
    stackTrace?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO error_logs (task_id, error_type, error_message, stack_trace, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(taskId || null, errorType, errorMessage, stackTrace || null);

    // Purge old logs if needed
    this.purgeOldErrorLogs();
  }

  /**
   * Get recent error logs
   */
  getRecentErrors(limit: number = 100): ErrorLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM error_logs
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.mapErrorLogRow(row));
  }

  /**
   * Get errors for a specific task
   */
  getTaskErrors(taskId: string): ErrorLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM error_logs
      WHERE task_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((row) => this.mapErrorLogRow(row));
  }

  /**
   * Purge old error logs (FIFO)
   */
  private purgeOldErrorLogs(): void {
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM error_logs');
    const { count } = countStmt.get() as { count: number };

    if (count > this.config.maxErrorLogs) {
      const deleteCount = count - this.config.maxErrorLogs;
      const deleteStmt = this.db.prepare(`
        DELETE FROM error_logs
        WHERE id IN (
          SELECT id FROM error_logs
          ORDER BY created_at ASC
          LIMIT ?
        )
      `);
      deleteStmt.run(deleteCount);
      getLogger().debug(`Purged ${deleteCount} old error logs`);
    }
  }

  /**
   * Map a database row to ErrorLogRecord
   */
  private mapErrorLogRow(row: Record<string, unknown>): ErrorLogRecord {
    return {
      id: row.id as number,
      taskId: row.task_id as string | null,
      errorType: row.error_type as string,
      errorMessage: row.error_message as string,
      stackTrace: row.stack_trace as string | null,
      createdAt: row.created_at as string,
    };
  }

  // ============================================
  // Stats & Utilities
  // ============================================

  /**
   * Get service statistics
   */
  getStats(): {
    total: number;
    classified: number;
    failed: number;
    pending: number;
    skipped: number;
  } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'classified' THEN 1 ELSE 0 END) as classified,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
      FROM tasks
    `);
    const row = stmt.get() as Record<string, number>;
    return {
      total: row.total || 0,
      classified: row.classified || 0,
      failed: row.failed || 0,
      pending: row.pending || 0,
      skipped: row.skipped || 0,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    getLogger().debug('Database connection closed');
  }
}

/**
 * Singleton database instance
 */
let dbInstance: DatabaseManager | null = null;

/**
 * Initialize the database
 */
export function initDatabase(config: Config): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager(config);
  }
  return dbInstance;
}

/**
 * Get the database instance
 */
export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return dbInstance;
}

/**
 * Close the database
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

