/**
 * Todoist incremental sync implementation
 * Uses the Sync API to efficiently fetch only changed tasks
 * 
 * Reference: https://developer.todoist.com/api/v1#tag/Sync/Overview/Incremental-sync
 */

import { getConfig } from './config.js';
import {
  getSyncToken,
  setSyncToken,
  getInboxProjectId,
  setInboxProjectId,
  upsertTask,
  getTask,
} from './database.js';
import { logger } from './logger.js';
import type { TodoistSyncResponse, TaskToClassify } from './types.js';

const SYNC_API_URL = 'https://api.todoist.com/api/v1/sync';

interface SyncResult {
  newTasks: TaskToClassify[];
  isFullSync: boolean;
}

/**
 * Perform an incremental sync with Todoist
 * Returns tasks that need classification
 */
export async function performIncrementalSync(): Promise<SyncResult> {
  const config = getConfig();
  const syncToken = getSyncToken();
  const isFullSync = syncToken === '*';
  
  logger.sync.starting(syncToken);
  
  try {
    // First sync: get projects to find inbox ID
    // Subsequent syncs: only get items
    const resourceTypes = isFullSync 
      ? ['items', 'projects'] 
      : ['items'];
    
    const response = await fetch(SYNC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.todoistApiToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        sync_token: syncToken,
        resource_types: JSON.stringify(resourceTypes),
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sync API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json() as TodoistSyncResponse;
    
    // Store the new sync token
    setSyncToken(data.sync_token);
    
    // On full sync, find and store the inbox project ID
    if (isFullSync && data.projects) {
      const inboxProject = data.projects.find(p => p.is_inbox_project);
      if (inboxProject) {
        setInboxProjectId(inboxProject.id);
        logger.debug('Found inbox project', { projectId: inboxProject.id });
      } else {
        logger.warn('Inbox project not found in projects list');
      }
    }
    
    // Get inbox project ID (from this sync or from stored value)
    const inboxProjectId = getInboxProjectId();
    
    if (!inboxProjectId) {
      logger.warn('Inbox project ID not available - cannot filter tasks');
      return { newTasks: [], isFullSync };
    }
    
    // Process items - filter to inbox only
    const tasksToClassify: TaskToClassify[] = [];
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        // Skip deleted or completed tasks
        if (item.is_deleted || item.checked) {
          continue;
        }
        
        // Only process tasks from inbox
        if (item.project_id !== inboxProjectId) {
          continue;
        }
        
        // Store/update task in database
        upsertTask({
          id: item.id,
          content: item.content,
          labels: item.labels,
          created_at: item.added_at,
        });
        
        // Check if task needs classification
        const existingTask = getTask(item.id);
        
        if (existingTask && existingTask.classified) {
          // Already classified, skip
          continue;
        }
        
        // Task needs classification
        tasksToClassify.push({
          id: item.id,
          content: item.content,
          description: item.description || '',
          existingLabels: item.labels,
        });
      }
    }
    
    if (tasksToClassify.length > 0) {
      logger.sync.completed(tasksToClassify.length, isFullSync);
    } else {
      logger.sync.noChanges();
    }
    
    return {
      newTasks: tasksToClassify,
      isFullSync,
    };
  } catch (error) {
    logger.sync.failed(error);
    throw error;
  }
}

/**
 * Force a full sync by resetting the sync token
 */
export function resetSyncToken(): void {
  setSyncToken('*');
  logger.info('Sync token reset - next sync will be a full sync');
}

/**
 * Get tasks from the database that need classification
 * (either new or failed previous attempts)
 */
export function getTasksNeedingClassification(): TaskToClassify[] {
  // This is handled by the database module, but we can add
  // additional logic here if needed
  return [];
}

