/**
 * Todoist API client wrapper for Todoist Autolabel Service
 *
 * Uses the official @doist/todoist-sdk (Todoist API v1). The legacy v9 REST
 * endpoints used by @doist/todoist-api-typescript were deprecated in Feb 2026
 * and now return 410 Gone.
 */

import { TodoistApi } from '@doist/todoist-sdk';
import type {
  Config,
  TodoistTask,
  TodoistLabel,
  ProjectId,
  Result,
} from './types.js';
import { ok, err, asProjectId, asTaskId, asLabelId } from './types.js';
import { getLogger } from './logger.js';

// Delay between API calls to avoid rate limiting (ms)
const API_DELAY_MS = 200;

// Minimal structural types describing the SDK return shapes we care about.
// Kept loose because the SDK ships zod-derived types with extra fields.
interface SdkTask {
  id: string;
  content: string;
  description?: string | null;
  projectId?: string | null;
  labels?: string[] | null;
  priority: number;
  addedAt?: Date | string | null;
  checked: boolean;
}

interface SdkProject {
  id: string;
  name: string;
  inboxProject?: boolean;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Coerce the SDK's `addedAt` (Date | string | null) to an ISO string.
 */
function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function mapTask(task: SdkTask): TodoistTask {
  return {
    id: asTaskId(task.id),
    content: task.content,
    description: task.description ?? '',
    projectId: task.projectId ? asProjectId(task.projectId) : null,
    labels: task.labels ?? [],
    priority: task.priority,
    createdAt: toIsoString(task.addedAt),
    isCompleted: task.checked,
  };
}

/**
 * Todoist API manager
 */
export class TodoistApiManager {
  private api: TodoistApi;
  private inboxProjectId: ProjectId | null = null;

  constructor(config: Config) {
    this.api = new TodoistApi(config.todoistApiToken);
  }

  /**
   * Initialize by fetching the inbox project ID.
   *
   * The v1 API paginates projects via cursor, so we walk pages until we
   * either find the inbox or exhaust results.
   */
  async initialize(): Promise<Result<void, string>> {
    const logger = getLogger();

    try {
      let cursor: string | null = null;
      let inbox: SdkProject | undefined;

      do {
        const response = (await this.api.getProjects({ cursor })) as {
          results: SdkProject[];
          nextCursor: string | null;
        };
        inbox = response.results.find((p) => p.inboxProject);
        if (inbox) break;
        cursor = response.nextCursor;
      } while (cursor);

      if (!inbox) {
        return err('Could not find Todoist Inbox project');
      }

      this.inboxProjectId = inbox.id as ProjectId;
      logger.info('Todoist API initialized', { inboxProjectId: this.inboxProjectId });
      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize Todoist API', error);
      return err(`Failed to initialize Todoist API: ${message}`);
    }
  }

  /**
   * Get the inbox project ID
   */
  getInboxProjectId(): Result<ProjectId, 'not_initialized'> {
    if (!this.inboxProjectId) {
      return err('not_initialized');
    }
    return ok(this.inboxProjectId);
  }

  /**
   * Get all tasks from the Inbox
   */
  async getInboxTasks(): Promise<Result<readonly TodoistTask[], string>> {
    const logger = getLogger();

    if (!this.inboxProjectId) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return err(initResult.error);
      }
    }

    try {
      const collected: SdkTask[] = [];
      let cursor: string | null = null;

      do {
        const response = (await this.api.getTasks({
          projectId: this.inboxProjectId!,
          cursor,
        })) as { results: SdkTask[]; nextCursor: string | null };

        collected.push(...response.results);
        cursor = response.nextCursor;
      } while (cursor);

      logger.debug(`Fetched ${collected.length} tasks from Inbox`);

      return ok(collected.map(mapTask));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch inbox tasks', error);
      return err(`Failed to fetch inbox tasks: ${message}`);
    }
  }

  /**
   * Get all labels from Todoist
   */
  async getLabels(): Promise<TodoistLabel[]> {
    const logger = getLogger();

    try {
      const collected: { id: string; name: string; color: string }[] = [];
      let cursor: string | null = null;

      do {
        const response = (await this.api.getLabels({ cursor })) as {
          results: { id: string; name: string; color: string }[];
          nextCursor: string | null;
        };
        collected.push(...response.results);
        cursor = response.nextCursor;
      } while (cursor);

      logger.debug(`Fetched ${collected.length} labels from Todoist`);

      return collected.map((label) => ({
        id: asLabelId(label.id),
        name: label.name,
        color: label.color,
      }));
    } catch (error) {
      logger.error('Failed to fetch labels', error);
      throw error;
    }
  }

  /**
   * Update labels on a task
   */
  async updateTaskLabels(taskId: string, labels: string[]): Promise<void> {
    const logger = getLogger();

    try {
      await sleep(API_DELAY_MS);

      await this.api.updateTask(taskId, { labels });

      logger.debug('Updated task labels', { taskId, labels });
    } catch (error) {
      logger.error('Failed to update task labels', error, { taskId, labels });
      throw error;
    }
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<TodoistTask | null> {
    const logger = getLogger();

    try {
      const task = (await this.api.getTask(taskId)) as SdkTask;
      return mapTask(task);
    } catch (error) {
      // Task might have been deleted
      logger.warn('Failed to fetch task', { taskId, error: String(error) });
      return null;
    }
  }

  /**
   * Validate that labels exist in Todoist
   */
  async validateLabels(labelNames: string[]): Promise<{
    valid: string[];
    invalid: string[];
  }> {
    const todoistLabels = await this.getLabels();
    const todoistLabelNames = new Set(todoistLabels.map((l) => l.name));

    const valid: string[] = [];
    const invalid: string[] = [];

    for (const name of labelNames) {
      if (todoistLabelNames.has(name)) {
        valid.push(name);
      } else {
        invalid.push(name);
      }
    }

    return { valid, invalid };
  }
}

/**
 * Singleton API instance
 */
let apiInstance: TodoistApiManager | null = null;

/**
 * Initialize the Todoist API manager
 */
export async function initTodoistApi(config: Config): Promise<TodoistApiManager> {
  if (!apiInstance) {
    apiInstance = new TodoistApiManager(config);
    await apiInstance.initialize();
  }
  return apiInstance;
}

/**
 * Get the Todoist API manager
 */
export function getTodoistApi(): TodoistApiManager {
  if (!apiInstance) {
    throw new Error('Todoist API not initialized. Call initTodoistApi first.');
  }
  return apiInstance;
}

/**
 * Reset the API instance (for testing)
 */
export function resetTodoistApi(): void {
  apiInstance = null;
}
