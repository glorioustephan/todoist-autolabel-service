/**
 * Unit tests for classifier.ts - Claude AI task classification with Structured Outputs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import {
  TaskClassifier,
  loadLabels,
  initClassifier,
  getClassifier,
  resetClassifier,
} from '../src/classifier.js';
import {
  createMockConfig,
  cleanupTempFiles,
  createMockLabels,
  createNetworkError,
  type MockLogger,
} from './test-utils.js';
import type { Config, ClassificationRequest } from '../src/types.js';

// Mock Anthropic SDK with beta.messages.create for Structured Outputs
const mockBetaMessagesCreate = vi.fn();
const mockAnthropicClient = {
  beta: {
    messages: {
      create: mockBetaMessagesCreate,
    },
  },
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => mockAnthropicClient),
  };
});

// Mock fs
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

// Mock logger
vi.mock('../src/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('classifier.ts - Claude AI Classification', () => {
  let config: Config;
  let tempFiles: string[] = [];
  let mockLogger: MockLogger;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetClassifier();
    tempFiles = [];

    // Get the mocked logger instance
    const { getLogger } = await import('../src/logger.js');
    mockLogger = vi.mocked(getLogger)() as unknown as MockLogger;

    config = createMockConfig({
      anthropicApiKey: 'test-anthropic-key',
      anthropicModel: 'claude-sonnet-4-5-20250929',
      maxLabelsPerTask: 3,
    });
  });

  afterEach(() => {
    cleanupTempFiles(tempFiles);
    resetClassifier();
  });

  describe('loadLabels()', () => {
    it('should load and return label names from valid JSON file', () => {
      const mockLabels = createMockLabels();
      const labelsConfig = { labels: mockLabels };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(labelsConfig));

      const labels = loadLabels('/path/to/labels.json');

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/labels.json', 'utf-8');
      expect(labels).toEqual(['productivity', 'work', 'personal', 'health', 'finance']);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Loaded 5 labels from /path/to/labels.json'
      );
    });

    it('should handle empty labels array', () => {
      const labelsConfig = { labels: [] };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(labelsConfig));

      const labels = loadLabels('/path/to/labels.json');

      expect(labels).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Loaded 0 labels from /path/to/labels.json'
      );
    });

    it('should throw error for invalid JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json {');

      expect(() => {
        loadLabels('/path/to/invalid.json');
      }).toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load labels',
        expect.any(Error),
        { labelsPath: '/path/to/invalid.json' }
      );
    });

    it('should throw error for missing labels property', () => {
      const invalidConfig = { notLabels: [] };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => {
        loadLabels('/path/to/labels.json');
      }).toThrow('Invalid labels.json: missing "labels" array');
    });

    it('should throw error for non-array labels property', () => {
      const invalidConfig = { labels: 'not-an-array' };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => {
        loadLabels('/path/to/labels.json');
      }).toThrow('Invalid labels.json: missing "labels" array');
    });

    it('should handle file read errors', () => {
      const readError = new Error('File not found');
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw readError;
      });

      expect(() => {
        loadLabels('/nonexistent/path.json');
      }).toThrow('File not found');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load labels',
        readError,
        { labelsPath: '/nonexistent/path.json' }
      );
    });
  });

  describe('TaskClassifier Class', () => {
    let classifier: TaskClassifier;

    beforeEach(() => {
      // Mock successful label loading
      const mockLabels = createMockLabels();
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ labels: mockLabels })
      );

      classifier = new TaskClassifier(config);
    });

    describe('Constructor', () => {
      it('should initialize with config and load labels', async () => {
        expect(fs.readFileSync).toHaveBeenCalledWith(config.labelsPath, 'utf-8');

        const anthropicModule = await import('@anthropic-ai/sdk');
        const mockAnthropic = vi.mocked(anthropicModule.default);
        expect(mockAnthropic).toHaveBeenCalledWith({
          apiKey: 'test-anthropic-key',
        });
      });
    });

    describe('getAvailableLabels()', () => {
      it('should return copy of available labels', () => {
        const labels1 = classifier.getAvailableLabels();
        const labels2 = classifier.getAvailableLabels();

        expect(labels1).toEqual(['productivity', 'work', 'personal', 'health', 'finance']);
        expect(labels1).not.toBe(labels2); // Should be different instances
        expect(labels1).toEqual(labels2); // But same content
      });
    });

    describe('reloadLabels()', () => {
      it('should reload labels from file', () => {
        const newLabels = [
          { name: 'new-label-1', color: 'red' },
          { name: 'new-label-2', color: 'blue' },
        ];

        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ labels: newLabels })
        );

        classifier.reloadLabels();

        expect(classifier.getAvailableLabels()).toEqual(['new-label-1', 'new-label-2']);
        expect(fs.readFileSync).toHaveBeenCalledTimes(2); // Initial + reload
      });

      it('should handle reload errors gracefully', () => {
        vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
          throw new Error('File access denied');
        });

        expect(() => {
          classifier.reloadLabels();
        }).toThrow('File access denied');
      });
    });

    describe('classifyTask()', () => {
      let classificationRequest: ClassificationRequest;

      beforeEach(() => {
        classificationRequest = {
          taskId: 'task-123',
          content: 'Complete project documentation',
          description: 'Write comprehensive docs for the new API',
          availableLabels: ['productivity', 'work', 'documentation'],
        };
      });

      it('should successfully classify task and return labels', async () => {
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: '{"labels": ["productivity", "work"]}',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(mockBetaMessagesCreate).toHaveBeenCalledWith({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 256,
          betas: ['structured-outputs-2025-11-13'],
          system: expect.stringContaining('task classification assistant'),
          messages: [
            {
              role: 'user',
              content: expect.stringContaining('Complete project documentation'),
            },
          ],
          output_format: {
            type: 'json_schema',
            schema: expect.objectContaining({
              type: 'object',
              properties: expect.objectContaining({
                labels: expect.objectContaining({
                  type: 'array',
                  items: expect.objectContaining({
                    type: 'string',
                    enum: ['productivity', 'work', 'documentation'],
                  }),
                }),
              }),
            }),
          },
        });

        expect(result).toEqual({
          taskId: 'task-123',
          labels: ['productivity', 'work'],
          rawResponse: '{"labels": ["productivity", "work"]}',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Classifying task',
          { taskId: 'task-123', content: 'Complete project documentation' }
        );

        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Classification result',
          {
            taskId: 'task-123',
            labels: ['productivity', 'work'],
          }
        );
      });

      it('should use default labels when availableLabels is empty', async () => {
        classificationRequest.availableLabels = [];

        const mockResponse = {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        await classifier.classifyTask(classificationRequest);

        // Should use all available labels from classifier
        const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
        expect(callArgs.messages[0].content).toContain('productivity');
        expect(callArgs.messages[0].content).toContain('work');
        expect(callArgs.messages[0].content).toContain('personal');
        // Schema should include all default labels
        expect(callArgs.output_format.schema.properties.labels.items.enum).toContain('productivity');
        expect(callArgs.output_format.schema.properties.labels.items.enum).toContain('work');
      });

      it('should handle empty task description', async () => {
        classificationRequest.description = '';

        const mockResponse = {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"labels": ["work"]}' }],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        await classifier.classifyTask(classificationRequest);

        const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
        expect(callArgs.messages[0].content).toContain('Complete project documentation');
        expect(callArgs.messages[0].content).not.toContain('Description:');
      });

      it('should limit labels to maxLabelsPerTask', async () => {
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: '{"labels": ["productivity", "work", "documentation", "urgent", "project"]}',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        // Should be limited to 3 labels (maxLabelsPerTask)
        expect(result.labels).toHaveLength(3);
        expect(result.labels).toEqual(['productivity', 'work', 'documentation']);
      });

      it('should handle structured output with valid labels only', async () => {
        // With structured outputs, enum constraint ensures only valid labels
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: '{"labels": ["productivity", "work"]}',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual(['productivity', 'work']);
      });

      it('should handle empty labels in structured response', async () => {
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: '{"labels": []}',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual([]);
      });

      it('should handle refusal response', async () => {
        const mockResponse = {
          stop_reason: 'refusal',
          content: [
            {
              type: 'text',
              text: 'I cannot classify this task.',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual([]);
        expect(result.rawResponse).toBe('Model refused to classify this task');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Classification refused by model',
          { taskId: 'task-123' }
        );
      });

      it('should handle JSON parse error gracefully', async () => {
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'not valid json',
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        await expect(classifier.classifyTask(classificationRequest)).rejects.toThrow();
      });

      it('should handle API errors', async () => {
        const apiError = createNetworkError();
        mockBetaMessagesCreate.mockRejectedValue(apiError);

        await expect(classifier.classifyTask(classificationRequest)).rejects.toThrow(
          'Network request failed'
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Classification failed',
          apiError,
          { taskId: 'task-123' }
        );
      });

      it('should handle non-text content in response', async () => {
        const mockResponse = {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'image', // Non-text content
              source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
            },
          ],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual([]);
        expect(result.rawResponse).toBe('{"labels":[]}');
      });

      it('should build comprehensive prompt with all task details', async () => {
        const detailedRequest: ClassificationRequest = {
          taskId: 'task-456',
          content: 'Buy groceries for dinner party',
          description: 'Need to get ingredients for Italian cuisine: pasta, tomatoes, cheese',
          availableLabels: ['shopping', 'food', 'social'],
        };

        const mockResponse = {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"labels": ["shopping", "food"]}' }],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        await classifier.classifyTask(detailedRequest);

        const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
        const prompt = callArgs.messages[0].content;

        expect(prompt).toContain('Buy groceries for dinner party');
        expect(prompt).toContain('Need to get ingredients for Italian cuisine');
        expect(prompt).toContain('shopping');
        expect(prompt).toContain('food');
        expect(prompt).toContain('social');
      });

      it('should handle edge case with empty available labels list', async () => {
        classificationRequest.availableLabels = [];

        const mockResponse = {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
        };
        mockBetaMessagesCreate.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual(['productivity']);
      });
    });

    describe('classifyTasks()', () => {
      it('should classify multiple tasks and return results', async () => {
        const requests: ClassificationRequest[] = [
          {
            taskId: 'task-1',
            content: 'Write documentation',
            description: '',
            availableLabels: ['productivity', 'work'],
          },
          {
            taskId: 'task-2',
            content: 'Exercise routine',
            description: 'Morning workout',
            availableLabels: ['health', 'personal'],
          },
        ];

        mockBetaMessagesCreate
          .mockResolvedValueOnce({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"labels": ["productivity", "work"]}' }],
          })
          .mockResolvedValueOnce({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"labels": ["health"]}' }],
          });

        const results = await classifier.classifyTasks(requests);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          taskId: 'task-1',
          labels: ['productivity', 'work'],
          rawResponse: '{"labels": ["productivity", "work"]}',
        });
        expect(results[1]).toEqual({
          taskId: 'task-2',
          labels: ['health'],
          rawResponse: '{"labels": ["health"]}',
        });
      });

      it('should handle individual task failures gracefully', async () => {
        const requests: ClassificationRequest[] = [
          {
            taskId: 'task-1',
            content: 'Successful task',
            description: '',
            availableLabels: ['productivity'],
          },
          {
            taskId: 'task-2',
            content: 'Failing task',
            description: '',
            availableLabels: ['work'],
          },
        ];

        const apiError = createNetworkError();
        mockBetaMessagesCreate
          .mockResolvedValueOnce({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
          })
          .mockRejectedValueOnce(apiError);

        const results = await classifier.classifyTasks(requests);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          taskId: 'task-1',
          labels: ['productivity'],
          rawResponse: '{"labels": ["productivity"]}',
        });
        expect(results[1]).toEqual({
          taskId: 'task-2',
          labels: [],
          rawResponse: 'Network request failed',
        });
      });

      it('should handle empty request array', async () => {
        const results = await classifier.classifyTasks([]);

        expect(results).toEqual([]);
        expect(mockBetaMessagesCreate).not.toHaveBeenCalled();
      });
    });
  });

  describe('Module Functions', () => {
    beforeEach(() => {
      // Mock successful label loading
      const mockLabels = createMockLabels();
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ labels: mockLabels })
      );
    });

    describe('initClassifier()', () => {
      it('should create classifier instance', () => {
        const classifier = initClassifier(config);

        expect(classifier).toBeInstanceOf(TaskClassifier);
        expect(fs.readFileSync).toHaveBeenCalledWith(config.labelsPath, 'utf-8');
      });

      it('should return same instance on subsequent calls', () => {
        const classifier1 = initClassifier(config);
        const classifier2 = initClassifier(config);

        expect(classifier1).toBe(classifier2);
      });
    });

    describe('getClassifier()', () => {
      it('should throw error if not initialized', () => {
        resetClassifier();

        expect(() => {
          getClassifier();
        }).toThrow('Classifier not initialized. Call initClassifier first.');
      });

      it('should return initialized classifier', () => {
        const initializedClassifier = initClassifier(config);
        const retrievedClassifier = getClassifier();

        expect(retrievedClassifier).toBe(initializedClassifier);
      });
    });

    describe('resetClassifier()', () => {
      it('should reset classifier instance', () => {
        initClassifier(config);
        resetClassifier();

        expect(() => {
          getClassifier();
        }).toThrow('Classifier not initialized');
      });

      it('should allow reinitialization after reset', () => {
        initClassifier(config);
        resetClassifier();

        const newClassifier = initClassifier(config);
        expect(newClassifier).toBeInstanceOf(TaskClassifier);
      });
    });
  });

  describe('Prompt Building and Response Parsing', () => {
    let classifier: TaskClassifier;

    beforeEach(() => {
      const mockLabels = [
        { name: 'productivity', color: 'blue' },
        { name: 'urgent', color: 'red' },
        { name: 'work', color: 'green' },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ labels: mockLabels })
      );

      classifier = new TaskClassifier(config);
    });

    it('should handle special characters in task content', async () => {
      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Task with "quotes" and & special chars <script>',
        description: 'Description with newlines\nand tabs\t',
        availableLabels: ['productivity', 'work'],
      };

      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      await classifier.classifyTask(request);

      const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
      const prompt = callArgs.messages[0].content;

      expect(prompt).toContain('Task with "quotes" and & special chars <script>');
      expect(prompt).toContain('Description with newlines\nand tabs\t');
    });

    it('should handle very long task content', async () => {
      const longContent = 'A'.repeat(10000);
      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: longContent,
        description: '',
        availableLabels: ['productivity'],
      };

      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      await classifier.classifyTask(request);

      const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(longContent);
    });

    it('should parse structured JSON responses correctly', async () => {
      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["productivity", "work"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Write API docs',
        description: '',
        availableLabels: ['productivity', 'work', 'documentation'],
      };

      const result = await classifier.classifyTask(request);

      expect(result.labels).toEqual(['productivity', 'work']);
    });

    it('should include enum constraint in schema', async () => {
      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Urgent documentation',
        description: '',
        availableLabels: ['productivity', 'work', 'urgent'],
      };

      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["productivity", "urgent"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      await classifier.classifyTask(request);

      const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
      expect(callArgs.output_format.schema.properties.labels.items.enum).toEqual([
        'productivity', 'work', 'urgent'
      ]);
    });

    it('should use system prompt for classification guidance', async () => {
      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["productivity"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Important task',
        description: '',
        availableLabels: ['productivity', 'urgent'],
      };

      await classifier.classifyTask(request);

      const callArgs = mockBetaMessagesCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('task classification assistant');
      expect(callArgs.system).toContain('1-5 labels');
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    let classifier: TaskClassifier;

    beforeEach(() => {
      const mockLabels = createMockLabels();
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ labels: mockLabels })
      );

      classifier = new TaskClassifier(config);
    });

    it('should handle rate limiting with exponential backoff simulation', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.name = 'RateLimitError';

      mockBetaMessagesCreate.mockRejectedValueOnce(rateLimitError);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Test task',
        description: '',
        availableLabels: ['productivity'],
      };

      await expect(classifier.classifyTask(request)).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('Invalid API key');
      authError.name = 'AuthenticationError';

      mockBetaMessagesCreate.mockRejectedValue(authError);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Test task',
        description: '',
        availableLabels: ['productivity'],
      };

      await expect(classifier.classifyTask(request)).rejects.toThrow('Invalid API key');
    });

    it('should handle very large label lists', async () => {
      const manyLabels = Array.from({ length: 1000 }, (_, i) => `label-${i}`);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Test with many labels',
        description: '',
        availableLabels: manyLabels,
      };

      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ labels: manyLabels.slice(0, 3) }) }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      const result = await classifier.classifyTask(request);

      expect(result.labels).toHaveLength(3);
    });

    it('should handle Unicode labels correctly', async () => {
      const unicodeLabels = ['工作', '生产力', '紧急', 'émojis🚀'];

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Unicode test task',
        description: '',
        availableLabels: unicodeLabels,
      };

      const mockResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"labels": ["工作", "émojis🚀"]}' }],
      };
      mockBetaMessagesCreate.mockResolvedValue(mockResponse);

      const result = await classifier.classifyTask(request);

      expect(result.labels).toEqual(['工作', 'émojis🚀']);
    });
  });
});
