/**
 * Type definitions for Todoist Autolabel Service
 */

// ============================================
// Configuration Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  // Required
  todoistApiToken: string;
  anthropicApiKey: string;

  // Claude configuration
  anthropicModel: string;
  maxLabelsPerTask: number;

  // Service configuration
  pollIntervalMs: number;
  maxErrorLogs: number;
  dbPath: string;
  logLevel: LogLevel;

  // Paths
  labelsPath: string;
}

// ============================================
// Todoist Types
// ============================================

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string | null;
  labels: string[];
  priority: number;
  createdAt: string;
  isCompleted: boolean;
}

export interface TodoistProject {
  id: string;
  name: string;
  isInboxProject: boolean;
}

export interface TodoistLabel {
  id: string;
  name: string;
  color: string;
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
// Classification Types
// ============================================

export interface ClassificationResult {
  taskId: string;
  labels: string[];
  confidence?: number;
  rawResponse?: string;
}

export interface ClassificationRequest {
  taskId: string;
  content: string;
  description: string;
  availableLabels: string[];
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

