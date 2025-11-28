/**
 * SQLite database layer for the Todoist autolabel service
 * Uses better-sqlite3 for synchronous, efficient database operations
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';
import type { TaskRecord, ErrorLogRecord } from './types.js';

let db: Database.Database | null = null;

/**
 * Initialize the database connection and create tables if they don't exist
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const config = getConfig();
  
  // Ensure the data directory exists
  const dataDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  
  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  
  // Create tables
  createTables(db);
  
  return db;
}

/**
 * Get the database instance (initializes if needed)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create all required tables
 */
function createTables(database: Database.Database): void {
  // Tasks table - tracks task classification state
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      classified INTEGER DEFAULT 0,
      classification_attempts INTEGER DEFAULT 0,
      labels TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      classified_at TEXT,
      last_error TEXT
    )
  `);

  // Sync state table - persists sync token and other state
  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Error logs table - stores errors with FIFO purging
  database.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT
    )
  `);

  // Create indexes for common queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_classified ON tasks(classified);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp);
  `);
}

// =============================================================================
// Task Operations
// =============================================================================

/**
 * Get a task by ID
 */
export function getTask(taskId: string): TaskRecord | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const row = stmt.get(taskId) as TaskRecord | undefined;
  return row || null;
}

/**
 * Insert or update a task
 */
export function upsertTask(task: {
  id: string;
  content: string;
  labels?: string[];
  created_at?: string;
}): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO tasks (id, content, labels, created_at, classified, classification_attempts)
    VALUES (?, ?, ?, ?, 0, 0)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      labels = excluded.labels
  `);
  
  stmt.run(
    task.id,
    task.content,
    JSON.stringify(task.labels || []),
    task.created_at || now
  );
}

/**
 * Get all unclassified tasks
 */
export function getUnclassifiedTasks(): TaskRecord[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE classified = 0 ORDER BY created_at ASC');
  return stmt.all() as TaskRecord[];
}

/**
 * Get tasks that failed classification and should be retried
 */
export function getFailedTasks(maxAttempts: number = 3): TaskRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM tasks 
    WHERE classified = 0 
    AND classification_attempts > 0 
    AND classification_attempts < ?
    ORDER BY created_at ASC
  `);
  return stmt.all(maxAttempts) as TaskRecord[];
}

/**
 * Mark a task as classified
 */
export function markTaskClassified(taskId: string, labels: string[]): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    UPDATE tasks 
    SET classified = 1, 
        labels = ?, 
        classified_at = ?,
        last_error = NULL
    WHERE id = ?
  `);
  
  stmt.run(JSON.stringify(labels), now, taskId);
}

/**
 * Mark a task classification as failed
 */
export function markTaskFailed(taskId: string, error: string): void {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE tasks 
    SET classification_attempts = classification_attempts + 1,
        last_error = ?
    WHERE id = ?
  `);
  
  stmt.run(error, taskId);
}

/**
 * Increment classification attempts for a task
 */
export function incrementClassificationAttempts(taskId: string): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE tasks SET classification_attempts = classification_attempts + 1 WHERE id = ?
  `);
  stmt.run(taskId);
}

/**
 * Check if a task exists and is classified
 */
export function isTaskClassified(taskId: string): boolean {
  const task = getTask(taskId);
  return task !== null && Boolean(task.classified);
}

/**
 * Delete old tasks that have been classified (cleanup)
 */
export function deleteOldClassifiedTasks(daysOld: number = 30): number {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const stmt = db.prepare(`
    DELETE FROM tasks 
    WHERE classified = 1 
    AND classified_at < ?
  `);
  
  const result = stmt.run(cutoffDate.toISOString());
  return result.changes;
}

// =============================================================================
// Sync State Operations
// =============================================================================

/**
 * Get a sync state value
 */
export function getSyncState(key: string): string | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT value FROM sync_state WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  return row?.value || null;
}

/**
 * Set a sync state value
 */
export function setSyncState(key: string, value: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(key, value, now);
}

/**
 * Get the sync token
 */
export function getSyncToken(): string {
  return getSyncState('sync_token') || '*';
}

/**
 * Set the sync token
 */
export function setSyncToken(token: string): void {
  setSyncState('sync_token', token);
}

/**
 * Get the inbox project ID (cached after first sync)
 */
export function getInboxProjectId(): string | null {
  return getSyncState('inbox_project_id');
}

/**
 * Set the inbox project ID
 */
export function setInboxProjectId(projectId: string): void {
  setSyncState('inbox_project_id', projectId);
}

// =============================================================================
// Error Log Operations
// =============================================================================

/**
 * Insert an error log entry
 */
export function insertErrorLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>
): void {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO error_logs (level, message, context)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(level, message, context ? JSON.stringify(context) : null);
}

/**
 * Get recent error logs
 */
export function getRecentErrorLogs(limit: number = 100): ErrorLogRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM error_logs 
    ORDER BY timestamp DESC 
    LIMIT ?
  `);
  return stmt.all(limit) as ErrorLogRecord[];
}

/**
 * Get error log count
 */
export function getErrorLogCount(): number {
  const db = getDatabase();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM error_logs');
  const result = stmt.get() as { count: number };
  return result.count;
}

/**
 * Purge old error logs using FIFO (keeps most recent maxLogs entries)
 */
export function purgeErrorLogs(maxLogs: number): number {
  const db = getDatabase();
  
  // Get the ID threshold - we want to delete everything below this
  const stmt = db.prepare(`
    SELECT id FROM error_logs 
    ORDER BY id DESC 
    LIMIT 1 OFFSET ?
  `);
  
  const threshold = stmt.get(maxLogs - 1) as { id: number } | undefined;
  
  if (!threshold) {
    // Not enough logs to purge
    return 0;
  }
  
  const deleteStmt = db.prepare('DELETE FROM error_logs WHERE id < ?');
  const result = deleteStmt.run(threshold.id);
  
  return result.changes;
}

/**
 * Purge error logs if count exceeds maximum
 */
export function purgeErrorLogsIfNeeded(): number {
  const config = getConfig();
  const count = getErrorLogCount();
  
  if (count > config.maxErrorLogs) {
    return purgeErrorLogs(config.maxErrorLogs);
  }
  
  return 0;
}

