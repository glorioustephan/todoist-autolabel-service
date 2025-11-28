/**
 * Todoist API module for updating task labels
 */

import { getConfig } from './config.js';
import { logger } from './logger.js';
import type { ProcessingResult, ClassificationResult } from './types.js';

const REST_API_BASE = 'https://api.todoist.com/rest/v2';

/**
 * Update a task's labels in Todoist
 */
export async function updateTaskLabels(
  taskId: string,
  labels: string[]
): Promise<boolean> {
  const config = getConfig();
  
  logger.todoist.updating(taskId, labels);
  
  try {
    const response = await fetch(`${REST_API_BASE}/tasks/${taskId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.todoistApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ labels }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }
    
    logger.todoist.updated(taskId);
    return true;
  } catch (error) {
    logger.todoist.updateFailed(taskId, error);
    return false;
  }
}

/**
 * Get the current labels for a task
 */
export async function getTaskLabels(taskId: string): Promise<string[] | null> {
  const config = getConfig();
  
  try {
    const response = await fetch(`${REST_API_BASE}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${config.todoistApiToken}`,
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        // Task may have been deleted
        return null;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const task = await response.json() as { labels: string[] };
    return task.labels;
  } catch (error) {
    logger.exception('Failed to get task labels', error, { taskId });
    return null;
  }
}

/**
 * Apply classification results to tasks
 * Merges existing labels with new labels
 */
export async function applyClassificationResults(
  results: ClassificationResult[]
): Promise<ProcessingResult[]> {
  const processingResults: ProcessingResult[] = [];
  
  for (const result of results) {
    // Skip if no new labels to add
    if (result.suggestedLabels.length === 0) {
      processingResults.push({
        taskId: result.taskId,
        success: true,
        labelsApplied: [],
      });
      continue;
    }
    
    // Get current labels for the task
    const currentLabels = await getTaskLabels(result.taskId);
    
    if (currentLabels === null) {
      // Task not found - might have been deleted
      processingResults.push({
        taskId: result.taskId,
        success: false,
        error: 'Task not found',
      });
      continue;
    }
    
    // Merge existing and new labels (avoiding duplicates)
    const mergedLabels = [...new Set([...currentLabels, ...result.suggestedLabels])];
    
    // Update the task
    const success = await updateTaskLabels(result.taskId, mergedLabels);
    
    processingResults.push({
      taskId: result.taskId,
      success,
      labelsApplied: success ? result.suggestedLabels : [],
      error: success ? undefined : 'Failed to update task labels',
    });
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return processingResults;
}

/**
 * Get all labels from Todoist (for validation)
 */
export async function getTodoistLabels(): Promise<Array<{ id: string; name: string; color: string }>> {
  const config = getConfig();
  
  try {
    const response = await fetch(`${REST_API_BASE}/labels`, {
      headers: {
        'Authorization': `Bearer ${config.todoistApiToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json() as Array<{ id: string; name: string; color: string }>;
  } catch (error) {
    logger.exception('Failed to get Todoist labels', error);
    return [];
  }
}

/**
 * Create a label in Todoist if it doesn't exist
 */
export async function ensureLabelExists(
  name: string, 
  color?: string
): Promise<boolean> {
  const config = getConfig();
  
  try {
    // Check if label already exists
    const existingLabels = await getTodoistLabels();
    if (existingLabels.some(l => l.name.toLowerCase() === name.toLowerCase())) {
      return true;
    }
    
    // Create the label
    const response = await fetch(`${REST_API_BASE}/labels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.todoistApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, color: color || 'charcoal' }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    logger.info(`Created label: ${name}`);
    return true;
  } catch (error) {
    logger.exception(`Failed to create label: ${name}`, error);
    return false;
  }
}

/**
 * Ensure all labels from labels.json exist in Todoist
 */
export async function syncLabelsToTodoist(
  labels: Array<{ name: string; color: string }>
): Promise<void> {
  logger.info(`Syncing ${labels.length} labels to Todoist...`);
  
  const existingLabels = await getTodoistLabels();
  const existingNames = new Set(existingLabels.map(l => l.name.toLowerCase()));
  
  let created = 0;
  let skipped = 0;
  
  for (const label of labels) {
    if (existingNames.has(label.name.toLowerCase())) {
      skipped++;
      continue;
    }
    
    const success = await ensureLabelExists(label.name, label.color);
    if (success) {
      created++;
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  logger.info(`Label sync complete: ${created} created, ${skipped} already existed`);
}

