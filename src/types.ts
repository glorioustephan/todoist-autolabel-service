/**
 * Type definitions for Todoist Autolabel Service
 */

// ============================================
// Branded Types for Type Safety
// ============================================

declare const __brand: unique symbol;

export type Brand<T, U> = T & { [__brand]: U };

export type TaskId = Brand<string, 'TaskId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type LabelId = Brand<string, 'LabelId'>;
export type SyncToken = Brand<string, 'SyncToken'>;

// Branded type casting functions
export const asTaskId = (id: string): TaskId => id as TaskId;
export const asProjectId = (id: string): ProjectId => id as ProjectId;
export const asLabelId = (id: string): LabelId => id as LabelId;
export const asSyncToken = (token: string): SyncToken => token as SyncToken;

// ============================================
// Configuration Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  // Required
  readonly todoistApiToken: string;
  readonly anthropicApiKey: string;

  // Claude configuration
  readonly anthropicModel: string;
  readonly maxLabelsPerTask: number;

  // Service configuration
  readonly pollIntervalMs: number;
  readonly maxErrorLogs: number;
  readonly dbPath: string;
  readonly logLevel: LogLevel;

  // Paths
  readonly labelsPath: string;
}

// ============================================
// Todoist Types
// ============================================

export interface TodoistTask {
  readonly id: TaskId;
  readonly content: string;
  readonly description: string;
  readonly projectId: ProjectId | null;
  readonly labels: readonly string[];
  readonly priority: number;
  readonly createdAt: string;
  readonly isCompleted: boolean;
}

export interface TodoistProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly isInboxProject: boolean;
}

export interface TodoistLabel {
  readonly id: LabelId;
  readonly name: string;
  readonly color: string;
}

// ============================================
// Label Configuration Types
// ============================================

export interface LabelDefinition {
  name: string;
  color: string;
}

export interface LabelsConfig {
  labels: LabelDefinition[];
}

// ============================================
// Result Types for Error Handling
// ============================================

export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly success: true;
  readonly data: T;
}

export interface Err<E> {
  readonly success: false;
  readonly error: E;
}

export const ok = <T>(data: T): Ok<T> => ({ success: true, data });
export const err = <E>(error: E): Err<E> => ({ success: false, error });

// ============================================
// Classification Types
// ============================================

export interface ClassificationResult {
  readonly taskId: TaskId;
  readonly labels: readonly string[];
  readonly confidence?: number;
  readonly rawResponse?: string;
}

export interface ClassificationRequest {
  readonly taskId: TaskId;
  readonly content: string;
  readonly description: string;
  readonly availableLabels: readonly string[];
}

// ============================================
// Sync Types
// ============================================

export interface SyncState {
  syncToken: string | null;
  lastSyncAt: string | null;
  inboxProjectId: string | null;
}

export interface SyncResult {
  tasks: TodoistTask[];
  projects: TodoistProject[];
  fullSync: boolean;
}

// ============================================
// Database Types
// ============================================

export type TaskStatus = 'pending' | 'classified' | 'failed' | 'skipped';

export interface TaskRecord {
  taskId: string;
  content: string;
  status: TaskStatus;
  labels: string | null; // JSON array
  attempts: number;
  lastAttemptAt: string | null;
  classifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorLogRecord {
  id: number;
  taskId: string | null;
  errorType: string;
  errorMessage: string;
  stackTrace: string | null;
  createdAt: string;
}

export interface SyncStateRecord {
  key: string;
  value: string;
  updatedAt: string;
}

// ============================================
// Service Types
// ============================================

export interface ServiceStats {
  totalTasks: number;
  classifiedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  lastSyncAt: string | null;
}

