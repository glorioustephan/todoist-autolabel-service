/**
 * Claude AI classifier for Todoist Autolabel Service
 * Uses Structured Outputs for guaranteed valid JSON responses
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import type {
  Config,
  LabelsConfig,
  ClassificationResult,
  ClassificationRequest,
  Result,
} from './types.js';
import { ok, err } from './types.js';
import { getLogger } from './logger.js';

// Structured Outputs beta header
const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-11-13';

/**
 * Load labels from the labels.json file asynchronously
 */
export async function loadLabels(labelsPath: string): Promise<Result<readonly string[], string>> {
  const logger = getLogger();

  try {
    const content = await fs.readFile(labelsPath, 'utf-8');
    const config: unknown = JSON.parse(content);

    // Type guard for LabelsConfig
    if (!isLabelsConfig(config)) {
      return err('Invalid labels.json: missing "labels" array or malformed structure');
    }

    const labelNames = config.labels.map((l) => l.name);
    logger.debug(`Loaded ${labelNames.length} labels from ${labelsPath}`);

    return ok(labelNames);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to load labels', error, { labelsPath });
    return err(`Failed to load labels: ${message}`);
  }
}

/**
 * Type guard for LabelsConfig
 */
function isLabelsConfig(value: unknown): value is LabelsConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'labels' in value &&
    Array.isArray((value as { labels: unknown }).labels) &&
    (value as { labels: unknown[] }).labels.every(
      (label) =>
        typeof label === 'object' &&
        label !== null &&
        'name' in label &&
        typeof (label as { name: unknown }).name === 'string'
    )
  );
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
  private availableLabels: readonly string[] = [];
  private isInitialized = false;

  constructor(config: Config) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }

  /**
   * Initialize the classifier by loading labels
   */
  async initialize(): Promise<Result<void, string>> {
    if (this.isInitialized) {
      return ok(undefined);
    }

    const labelsResult = await loadLabels(this.config.labelsPath);
    if (!labelsResult.success) {
      return err(labelsResult.error);
    }

    this.availableLabels = labelsResult.data;
    this.isInitialized = true;
    return ok(undefined);
  }

  /**
   * Ensure the classifier is initialized
   */
  private async ensureInitialized(): Promise<Result<void, string>> {
    if (!this.isInitialized) {
      return await this.initialize();
    }
    return ok(undefined);
  }

  /**
   * Get available labels
   */
  getAvailableLabels(): readonly string[] {
    return this.availableLabels;
  }

  /**
   * Reload labels from file
   */
  async reloadLabels(): Promise<Result<void, string>> {
    this.isInitialized = false;
    return await this.initialize();
  }

  /**
   * Classify a task using Structured Outputs
   */
  async classifyTask(request: ClassificationRequest): Promise<Result<ClassificationResult, string>> {
    const logger = getLogger();

    const initResult = await this.ensureInitialized();
    if (!initResult.success) {
      return err(`Classifier not initialized: ${initResult.error}`);
    }

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
            content: buildUserPrompt(request.content, request.description, [...labelsToUse]),
          },
        ],
        output_format: {
          type: 'json_schema',
          schema: buildOutputSchema([...labelsToUse]),
        },
      });

      // Check for refusal
      if (message.stop_reason === 'refusal') {
        logger.warn('Classification refused by model', { taskId: request.taskId });
        return ok({
          taskId: request.taskId,
          labels: [],
          rawResponse: 'Model refused to classify this task',
        });
      }

      // Extract and parse the guaranteed-valid JSON response
      const responseText = message.content[0]?.type === 'text'
        ? message.content[0].text
        : '{"labels":[]}';

      const parsed: ClassificationResponse = JSON.parse(responseText);

      // Limit to configured max labels
      const labels = parsed.labels.slice(0, this.config.maxLabelsPerTask);

      logger.debug('Classification result', {
        taskId: request.taskId,
        labels,
      });

      return ok({
        taskId: request.taskId,
        labels,
        rawResponse: responseText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Classification failed', error, { taskId: request.taskId });
      return err(`Classification failed: ${message}`);
    }
  }

  /**
   * Classify multiple tasks using functional composition
   */
  async classifyTasks(requests: readonly ClassificationRequest[]): Promise<readonly ClassificationResult[]> {
    const classifyWithFallback = async (request: ClassificationRequest): Promise<ClassificationResult> => {
      const result = await this.classifyTask(request);

      if (result.success) {
        return result.data;
      }

      // Return fallback result on error
      return {
        taskId: request.taskId,
        labels: [],
        rawResponse: result.error,
      };
    };

    return Promise.all(requests.map(classifyWithFallback));
  }
}

/**
 * Singleton classifier instance
 */
let classifierInstance: TaskClassifier | null = null;

/**
 * Initialize the classifier
 */
export async function initClassifier(config: Config): Promise<Result<TaskClassifier, string>> {
  if (!classifierInstance) {
    classifierInstance = new TaskClassifier(config);
  }

  const initResult = await classifierInstance.initialize();
  if (!initResult.success) {
    return err(initResult.error);
  }

  return ok(classifierInstance);
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
