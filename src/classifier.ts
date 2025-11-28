/**
 * Claude AI classifier for Todoist Autolabel Service
 * Uses Structured Outputs for guaranteed valid JSON responses
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

// Structured Outputs beta header
const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-11-13';

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
 * Build the classification system prompt
 */
function buildSystemPrompt(): string {
  return `You are a task classification assistant. Your job is to analyze tasks and assign the most appropriate labels from a predefined taxonomy.

Guidelines:
- Select 1-5 labels that best categorize the task
- Prefer more specific labels over general ones when applicable
- Consider both the task title and description when classifying
- If unsure, choose broader category labels`;
}

/**
 * Build the classification user prompt
 */
function buildUserPrompt(
  taskContent: string,
  taskDescription: string,
  availableLabels: string[]
): string {
  const labelsFormatted = availableLabels.join(', ');
  
  let prompt = `Classify this task and assign appropriate labels.

Task: ${taskContent}`;

  if (taskDescription) {
    prompt += `\nDescription: ${taskDescription}`;
  }

  prompt += `\n\nAvailable labels: ${labelsFormatted}`;

  return prompt;
}

/**
 * Build the JSON schema for structured output
 */
function buildOutputSchema(availableLabels: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'string',
          enum: availableLabels,
        },
        description: 'Array of label names that best categorize this task',
      },
    },
    required: ['labels'],
    additionalProperties: false,
  };
}

/**
 * Response type from structured output
 */
interface ClassificationResponse {
  labels: string[];
}

/**
 * Task classifier using Claude AI with Structured Outputs
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
   * Classify a task using Structured Outputs
   */
  async classifyTask(request: ClassificationRequest): Promise<ClassificationResult> {
    const logger = getLogger();
    const labelsToUse = request.availableLabels.length > 0 
      ? request.availableLabels 
      : this.availableLabels;

    try {
      logger.debug('Classifying task', { taskId: request.taskId, content: request.content });

      // Use beta API with structured outputs for guaranteed valid JSON
      const message = await this.client.beta.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 256,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: buildUserPrompt(request.content, request.description, labelsToUse),
          },
        ],
        output_format: {
          type: 'json_schema',
          schema: buildOutputSchema(labelsToUse),
        },
      });

      // Check for refusal
      if (message.stop_reason === 'refusal') {
        logger.warn('Classification refused by model', { taskId: request.taskId });
        return {
          taskId: request.taskId,
          labels: [],
          rawResponse: 'Model refused to classify this task',
        };
      }

      // Extract and parse the guaranteed-valid JSON response
      const responseText = message.content[0].type === 'text' 
        ? message.content[0].text 
        : '{"labels":[]}';

      const parsed: ClassificationResponse = JSON.parse(responseText);
      
      // Limit to configured max labels
      const labels = parsed.labels.slice(0, this.config.maxLabelsPerTask);

      logger.debug('Classification result', {
        taskId: request.taskId,
        labels,
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
