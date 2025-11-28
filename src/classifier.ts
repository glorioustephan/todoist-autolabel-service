/**
 * Task classification module using local Transformers.js
 * with Claude Haiku fallback for low-confidence results
 */

import { pipeline } from '@xenova/transformers';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import type { 
  ClassificationResult, 
  ClassificationRequest, 
  LabelDefinition, 
  LabelsFile 
} from './types.js';

// Singleton classifier instance
let classifierPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;
let anthropicClient: Anthropic | null = null;
let availableLabels: LabelDefinition[] = [];

/**
 * Initialize the classification pipeline
 */
export async function initClassifier(): Promise<void> {
  const config = getConfig();
  
  // Load labels from file
  if (fs.existsSync(config.labelsPath)) {
    const labelsContent = fs.readFileSync(config.labelsPath, 'utf-8');
    const labelsFile = JSON.parse(labelsContent) as LabelsFile;
    availableLabels = labelsFile.labels;
    logger.info(`Loaded ${availableLabels.length} labels from ${config.labelsPath}`);
  } else {
    throw new Error(`Labels file not found: ${config.labelsPath}`);
  }
  
  // Initialize local ML classifier
  logger.info('Initializing local ML classifier (this may take a moment on first run)...');
  
  try {
    // Use zero-shot-classification pipeline with DistilBERT model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    classifierPipeline = await (pipeline as any)(
      'zero-shot-classification',
      'Xenova/distilbert-base-uncased-mnli',
      { 
        // Cache models locally
        cache_dir: './.transformers-cache',
      }
    );
    
    logger.info('Local ML classifier initialized successfully');
  } catch (error) {
    logger.exception('Failed to initialize local ML classifier', error);
    throw error;
  }
  
  // Initialize Anthropic client if API key is available
  if (config.anthropicApiKey) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    logger.info('Claude Haiku fallback initialized');
  } else {
    logger.warn('ANTHROPIC_API_KEY not set - fallback classification disabled');
  }
}

/**
 * Get available label names
 */
export function getAvailableLabelNames(): string[] {
  return availableLabels.map(l => l.name);
}

/**
 * Classify a task using local ML
 */
async function classifyWithLocalML(
  request: ClassificationRequest
): Promise<ClassificationResult | null> {
  if (!classifierPipeline) {
    throw new Error('Classifier not initialized. Call initClassifier() first.');
  }
  
  const config = getConfig();
  const labelNames = getAvailableLabelNames();
  
  // Combine content and description for better classification
  const textToClassify = request.description 
    ? `${request.content}. ${request.description}`
    : request.content;
  
  try {
    // Run zero-shot classification
    // The model will score each label against the text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (classifierPipeline as any)(textToClassify, labelNames, {
      multi_label: true, // Allow multiple labels
    }) as {
      sequence: string;
      labels: string[];
      scores: number[];
    };
    
    // Filter labels above confidence threshold
    const suggestedLabels: string[] = [];
    let maxConfidence = 0;
    
    for (let i = 0; i < result.labels.length; i++) {
      const score = result.scores[i];
      if (score > config.classificationConfidenceThreshold) {
        // Don't add labels that already exist on the task
        if (!request.existingLabels.includes(result.labels[i])) {
          suggestedLabels.push(result.labels[i]);
        }
      }
      if (score > maxConfidence) {
        maxConfidence = score;
      }
    }
    
    // If max confidence is below threshold, return null to trigger fallback
    if (maxConfidence < config.classificationConfidenceThreshold) {
      logger.debug('Local ML confidence too low', { 
        taskId: request.taskId, 
        maxConfidence,
        threshold: config.classificationConfidenceThreshold 
      });
      return null;
    }
    
    return {
      taskId: request.taskId,
      suggestedLabels,
      confidence: maxConfidence,
      source: 'local',
    };
  } catch (error) {
    logger.exception('Local ML classification failed', error, { taskId: request.taskId });
    return null;
  }
}

/**
 * Classify a task using Claude Haiku as fallback
 */
async function classifyWithHaiku(
  request: ClassificationRequest
): Promise<ClassificationResult | null> {
  if (!anthropicClient) {
    logger.warn('Haiku fallback not available - no API key configured');
    return null;
  }
  
  const labelNames = getAvailableLabelNames();
  
  const prompt = `You are a task classification assistant. Given a task, assign the most relevant labels from the available list.

Available labels: ${labelNames.join(', ')}

Task: "${request.content}"
${request.description ? `Description: "${request.description}"` : ''}
${request.existingLabels.length > 0 ? `Current labels (do not repeat): ${request.existingLabels.join(', ')}` : ''}

Respond with ONLY a JSON object in this exact format:
{
  "labels": ["label1", "label2"],
  "reasoning": "Brief explanation"
}

Select 1-5 most relevant labels. Only use labels from the available list. If none fit well, return an empty array.`;

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    
    const responseText = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';
    
    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as { labels: string[]; reasoning?: string };
    
    // Validate labels exist in our list
    const validLabels = parsed.labels.filter(label => 
      labelNames.includes(label) && !request.existingLabels.includes(label)
    );
    
    return {
      taskId: request.taskId,
      suggestedLabels: validLabels,
      confidence: 1.0, // Haiku doesn't provide confidence scores
      source: 'fallback',
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    // Check for API credit/billing errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('credit') || errorMessage.includes('billing') || errorMessage.includes('insufficient')) {
      logger.error('Claude API credits exhausted or billing issue', { error: errorMessage });
    } else {
      logger.exception('Haiku classification failed', error, { taskId: request.taskId });
    }
    return null;
  }
}

/**
 * Classify a single task
 * Uses local ML first, falls back to Haiku if confidence is low
 */
export async function classifyTask(
  request: ClassificationRequest
): Promise<ClassificationResult | null> {
  const config = getConfig();
  
  // Try local ML first
  const localResult = await classifyWithLocalML(request);
  
  if (localResult && localResult.suggestedLabels.length > 0) {
    return localResult;
  }
  
  // If local ML failed or returned no labels, try fallback
  if (config.anthropicApiKey) {
    logger.classification.fallbackTriggered(
      request.taskId, 
      localResult ? 'No labels above threshold' : 'Local ML failed'
    );
    
    const fallbackResult = await classifyWithHaiku(request);
    
    if (fallbackResult) {
      return fallbackResult;
    }
    
    logger.classification.fallbackFailed(request.taskId, new Error('Haiku returned no results'));
  }
  
  // Both methods failed or returned no labels
  return {
    taskId: request.taskId,
    suggestedLabels: [],
    confidence: 0,
    source: 'local',
    reasoning: 'No suitable labels found',
  };
}

/**
 * Classify multiple tasks
 */
export async function classifyTasks(
  requests: ClassificationRequest[]
): Promise<ClassificationResult[]> {
  logger.classification.starting(requests.length);
  
  const results: ClassificationResult[] = [];
  let successful = 0;
  let failed = 0;
  
  for (const request of requests) {
    try {
      const result = await classifyTask(request);
      
      if (result) {
        results.push(result);
        if (result.suggestedLabels.length > 0) {
          successful++;
          logger.classification.taskClassified(
            result.taskId, 
            result.suggestedLabels, 
            result.source,
            result.confidence
          );
        }
      }
    } catch (error) {
      failed++;
      logger.classification.taskFailed(request.taskId, error);
    }
  }
  
  logger.classification.completed(requests.length, successful, failed);
  
  return results;
}

/**
 * Check if classifier is initialized
 */
export function isClassifierReady(): boolean {
  return classifierPipeline !== null;
}

