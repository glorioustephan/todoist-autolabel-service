/**
 * Shared type definitions for the Todoist autolabel service
 */

// Label definition from labels.json
export interface LabelDefinition {
  name: string;
  color: string;
}

export interface LabelsFile {
  labels: LabelDefinition[];
}

// Todoist Sync API types
export interface TodoistSyncTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  labels: string[];
  priority: number;
  parent_id: string | null;
  child_order: number;
  section_id: string | null;
  day_order: number;
  collapsed: boolean;
  checked: boolean;
  is_deleted: boolean;
  added_at: string;
  due: {
    date: string;
    timezone: string | null;
    string: string;
    lang: string;
    is_recurring: boolean;
  } | null;
}

export interface TodoistSyncResponse {
  sync_token: string;
  full_sync: boolean;
  items?: TodoistSyncTask[];
  projects?: Array<{
    id: string;
    name: string;
    is_inbox_project?: boolean;
  }>;
}

// Database types
export interface TaskRecord {
  id: string;
  content: string;
  classified: boolean;
  classification_attempts: number;
  labels: string; // JSON array string
  created_at: string;
  classified_at: string | null;
  last_error: string | null;
}

export interface SyncStateRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface ErrorLogRecord {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  context: string | null; // JSON string
}

// Classification types
export interface ClassificationResult {
  taskId: string;
  suggestedLabels: string[];
  confidence: number;
  source: 'local' | 'fallback';
  reasoning?: string;
}

export interface ClassificationRequest {
  taskId: string;
  content: string;
  description?: string;
  existingLabels: string[];
}

// Service types
export interface TaskToClassify {
  id: string;
  content: string;
  description: string;
  existingLabels: string[];
}

export interface ProcessingResult {
  taskId: string;
  success: boolean;
  labelsApplied?: string[];
  error?: string;
}

