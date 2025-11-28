/**
 * Claude AI classifier for Todoist Autolabel Service
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import type {
  Config,
  LabelsConfig,
  ClassificationResult,
  ClassificationRequest,
} from './types.js';
import { getLogger } from './logger.js';

/**
 * Load labels from the labels.json file
 */
export function loadLabels(labelsPath: string): string[] {
  const logger = getLogger();

  try {
    const content = fs.readFileSync(labelsPath, 'utf-8');
    const config: LabelsConfig = JSON.parse(content);

    if (!config.labels || !Array.isArray(config.labels)) {
      throw new Error('Invalid labels.json: missing "labels" array');
    }

    const labelNames = config.labels.map((l) => l.name);
    logger.debug(`Loaded ${labelNames.length} labels from ${labelsPath}`);

    return labelNames;
  } catch (error) {
    logger.error('Failed to load labels', error, { labelsPath });
    throw error;
  }
}

/**
 * Build the classification prompt
 */
function buildClassificationPrompt(
  taskContent: string,
  taskDescription: string,
  availableLabels: string[]
): string {
  const labelsFormatted = availableLabels.map((l) => `  - ${l}`).join('\n');

  return `You are a task classification assistant. Your job is to analyze a task and assign the most appropriate labels from a predefined taxonomy.

## Available Labels
${labelsFormatted}

## Task to Classify
**Title:** ${taskContent}
${taskDescription ? `**Description:** ${taskDescription}` : ''}

## Instructions
1. Analyze the task content and description carefully
2. Select 1-5 labels that best categorize this task
3. Only use labels from the available labels list above
4. Prefer more specific labels over general ones when applicable
5. Return ONLY a JSON array of label names, nothing else

## Response Format
Return a JSON array of label names. Example:
["label-one", "label-two"]

Your response (JSON array only):`;
}

/**
 * Parse Claude's response to extract labels
 */
function parseClassificationResponse(
  response: string,
  availableLabels: string[],
  maxLabels: number
): string[] {
  const logger = getLogger();
  const availableSet = new Set(availableLabels);

  // Try to extract JSON array from response
  let labels: string[] = [];

  // Look for JSON array pattern
  const jsonMatch = response.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        labels = parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      logger.warn('Failed to parse JSON from response', { response });
    }
  }

  // If no JSON found, try to extract label-like strings
  if (labels.length === 0) {
    // Look for strings that match available labels
    for (const label of availableLabels) {
      if (response.toLowerCase().includes(label.toLowerCase())) {
        labels.push(label);
      }
    }
  }

  // Filter to only valid labels
  const validLabels = labels.filter((label) => availableSet.has(label));

  // Limit to max labels
  return validLabels.slice(0, maxLabels);
}

/**
 * Task classifier using Claude AI
 */
export class TaskClassifier {
  private client: Anthropic;
  private config: Config;
  private availableLabels: string[];

  constructor(config: Config) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    this.availableLabels = loadLabels(config.labelsPath);
  }

  /**
   * Get available labels
   */
  getAvailableLabels(): string[] {
    return [...this.availableLabels];
  }

  /**
   * Reload labels from file
   */
  reloadLabels(): void {
    this.availableLabels = loadLabels(this.config.labelsPath);
  }

  /**
   * Classify a task
   */
  async classifyTask(request: ClassificationRequest): Promise<ClassificationResult> {
    const logger = getLogger();

    const prompt = buildClassificationPrompt(
      request.content,
      request.description,
      request.availableLabels.length > 0 ? request.availableLabels : this.availableLabels
    );

    try {
      logger.debug('Classifying task', { taskId: request.taskId, content: request.content });

      const message = await this.client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const responseText =
        message.content[0].type === 'text' ? message.content[0].text : '';

      // Parse labels from response
      const labels = parseClassificationResponse(
        responseText,
        request.availableLabels.length > 0 ? request.availableLabels : this.availableLabels,
        this.config.maxLabelsPerTask
      );

      logger.debug('Classification result', {
        taskId: request.taskId,
        labels,
        rawResponse: responseText,
      });

      return {
        taskId: request.taskId,
        labels,
        rawResponse: responseText,
      };
    } catch (error) {
      logger.error('Classification failed', error, { taskId: request.taskId });
      throw error;
    }
  }

  /**
   * Classify multiple tasks
   */
  async classifyTasks(requests: ClassificationRequest[]): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    for (const request of requests) {
      try {
        const result = await this.classifyTask(request);
        results.push(result);
      } catch (error) {
        // Return partial result with empty labels on error
        results.push({
          taskId: request.taskId,
          labels: [],
          rawResponse: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}

/**
 * Singleton classifier instance
 */
let classifierInstance: TaskClassifier | null = null;

/**
 * Initialize the classifier
 */
export function initClassifier(config: Config): TaskClassifier {
  if (!classifierInstance) {
    classifierInstance = new TaskClassifier(config);
  }
  return classifierInstance;
}

/**
 * Get the classifier instance
 */
export function getClassifier(): TaskClassifier {
  if (!classifierInstance) {
    throw new Error('Classifier not initialized. Call initClassifier first.');
  }
  return classifierInstance;
}

/**
 * Reset the classifier instance (for testing)
 */
export function resetClassifier(): void {
  classifierInstance = null;
}

