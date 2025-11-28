/**
 * Todoist API client wrapper for Todoist Autolabel Service
 */

import { TodoistApi } from '@doist/todoist-api-typescript';
import type { Config, TodoistTask, TodoistLabel } from './types.js';
import { getLogger } from './logger.js';

// Delay between API calls to avoid rate limiting (ms)
const API_DELAY_MS = 200;

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Todoist API manager
 */
export class TodoistApiManager {
  private api: TodoistApi;
  private inboxProjectId: string | null = null;

  constructor(config: Config) {
    this.api = new TodoistApi(config.todoistApiToken);
  }

  /**
   * Initialize by fetching the inbox project ID
   */
  async initialize(): Promise<void> {
    const logger = getLogger();
    
    try {
      const projects = await this.api.getProjects();
      const inbox = projects.find((p) => p.isInboxProject);
      
      if (!inbox) {
        throw new Error('Could not find Todoist Inbox project');
      }
      
      this.inboxProjectId = inbox.id;
      logger.info('Todoist API initialized', { inboxProjectId: this.inboxProjectId });
    } catch (error) {
      logger.error('Failed to initialize Todoist API', error);
      throw error;
    }
  }

  /**
   * Get the inbox project ID
   */
  getInboxProjectId(): string {
    if (!this.inboxProjectId) {
      throw new Error('Todoist API not initialized. Call initialize() first.');
    }
    return this.inboxProjectId;
  }

  /**
   * Get all tasks from the Inbox
   */
  async getInboxTasks(): Promise<TodoistTask[]> {
    const logger = getLogger();
    
    if (!this.inboxProjectId) {
      await this.initialize();
    }

    try {
      const tasks = await this.api.getTasks({ projectId: this.inboxProjectId! });
      
      logger.debug(`Fetched ${tasks.length} tasks from Inbox`);
      
      return tasks.map((task) => ({
        id: task.id,
        content: task.content,
        description: task.description || '',
        projectId: task.projectId,
        labels: task.labels || [],
        priority: task.priority,
        createdAt: task.createdAt,
        isCompleted: task.isCompleted,
      }));
    } catch (error) {
      logger.error('Failed to fetch inbox tasks', error);
      throw error;
    }
  }

  /**
   * Get all labels from Todoist
   */
  async getLabels(): Promise<TodoistLabel[]> {
    const logger = getLogger();

    try {
      const labels = await this.api.getLabels();
      
      logger.debug(`Fetched ${labels.length} labels from Todoist`);
      
      return labels.map((label) => ({
        id: label.id,
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
      const task = await this.api.getTask(taskId);
      
      return {
        id: task.id,
        content: task.content,
        description: task.description || '',
        projectId: task.projectId,
        labels: task.labels || [],
        priority: task.priority,
        createdAt: task.createdAt,
        isCompleted: task.isCompleted,
      };
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

