/**
 * Public library entry point for @glorioustephan/todoist-autolabel.
 *
 * Consumers that prefer to embed the service rather than run the CLI can
 * import these primitives and drive the sync loop themselves.
 */

export { loadConfig, getConfig, resetConfig } from './config.js';
export { createLogger, getLogger } from './logger.js';
export {
  initDatabase,
  getDatabase,
  closeDatabase,
} from './database.js';
export {
  TodoistApiManager,
  initTodoistApi,
  getTodoistApi,
  resetTodoistApi,
} from './todoist-api.js';
export {
  initClassifier,
  getClassifier,
  resetClassifier,
} from './classifier.js';
export {
  SyncManager,
  initSyncManager,
  getSyncManager,
  resetSyncManager,
} from './sync.js';

export type {
  Config,
  LogLevel,
  TodoistTask,
  TodoistProject,
  TodoistLabel,
  TaskId,
  ProjectId,
  LabelId,
  LabelDefinition,
  LabelsConfig,
  Result,
  Ok,
  Err,
  ClassificationRequest,
  ClassificationResult,
  TaskStatus,
  TaskRecord,
  ErrorLogRecord,
  ServiceStats,
} from './types.js';
