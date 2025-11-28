/**
 * Unit tests for classifier.ts - Claude AI task classification
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
  createTempLabelsFile,
  cleanupTempFiles,
  createMockLabels,
  createNetworkError,
} from './test-utils.js';
import type { Config, ClassificationRequest } from '../src/types.js';

// Mock Anthropic SDK
const mockAnthropicClient = {
  messages: {
    create: vi.fn(),
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
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetClassifier();
    tempFiles = [];

    // Get the mocked logger instance
    const { getLogger } = await import('../src/logger.js');
    mockLogger = vi.mocked(getLogger)();

    config = createMockConfig({
      anthropicApiKey: 'test-anthropic-key',
      anthropicModel: 'claude-haiku-4-5-20251001',
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
          content: [
            {
              type: 'text',
              text: '["productivity", "work"]',
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [
            {
              role: 'user',
              content: expect.stringContaining('Complete project documentation'),
            },
          ],
        });

        expect(result).toEqual({
          taskId: 'task-123',
          labels: ['productivity', 'work'],
          rawResponse: '["productivity", "work"]',
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
            rawResponse: '["productivity", "work"]',
          }
        );
      });

      it('should use default labels when availableLabels is empty', async () => {
        classificationRequest.availableLabels = [];

        const mockResponse = {
          content: [{ type: 'text', text: '["productivity"]' }],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        await classifier.classifyTask(classificationRequest);

        // Should use all available labels from classifier
        const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
        expect(promptCall.messages[0].content).toContain('productivity');
        expect(promptCall.messages[0].content).toContain('work');
        expect(promptCall.messages[0].content).toContain('personal');
      });

      it('should handle empty task description', async () => {
        classificationRequest.description = '';

        const mockResponse = {
          content: [{ type: 'text', text: '["work"]' }],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        await classifier.classifyTask(classificationRequest);

        const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
        expect(promptCall.messages[0].content).toContain('Complete project documentation');
        expect(promptCall.messages[0].content).not.toContain('**Description:**');
      });

      it('should limit labels to maxLabelsPerTask', async () => {
        const mockResponse = {
          content: [
            {
              type: 'text',
              text: '["productivity", "work", "documentation", "urgent", "project"]', // 5 labels
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        // Should be limited to 3 labels (maxLabelsPerTask)
        expect(result.labels).toHaveLength(3);
        expect(result.labels).toEqual(['productivity', 'work', 'documentation']);
      });

      it('should filter out invalid labels', async () => {
        const mockResponse = {
          content: [
            {
              type: 'text',
              text: '["productivity", "invalid-label", "work"]',
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        // Should only include valid labels
        expect(result.labels).toEqual(['productivity', 'work']);
      });

      it('should handle malformed JSON response gracefully', async () => {
        const malformedResponse = 'Here are the labels: ["unclosed_string, "another"]'; // Malformed JSON - unclosed string
        const mockResponse = {
          content: [
            {
              type: 'text',
              text: malformedResponse,
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to parse JSON from response',
          { response: malformedResponse }
        );
      });

      it('should extract labels from partial JSON', async () => {
        const mockResponse = {
          content: [
            {
              type: 'text',
              text: 'Here are the labels: ["productivity", "work"] for this task.',
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual(['productivity', 'work']);
      });

      it('should fallback to text extraction when no JSON found', async () => {
        // Mock labels that appear in text but no JSON array
        classificationRequest.availableLabels = ['productivity', 'urgent'];

        const mockResponse = {
          content: [
            {
              type: 'text',
              text: 'This task is about productivity and seems urgent',
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual(['productivity', 'urgent']);
      });

      it('should handle non-string items in JSON array', async () => {
        const mockResponse = {
          content: [
            {
              type: 'text',
              text: '["productivity", 123, "work", null, "documentation"]',
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        // Should filter out non-strings
        expect(result.labels).toEqual(['productivity', 'work', 'documentation']);
      });

      it('should handle API errors', async () => {
        const apiError = createNetworkError();
        mockAnthropicClient.messages.create.mockRejectedValue(apiError);

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
          content: [
            {
              type: 'image', // Non-text content
              source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
            },
          ],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        const result = await classifier.classifyTask(classificationRequest);

        expect(result.labels).toEqual([]);
        expect(result.rawResponse).toBe('');
      });

      it('should build comprehensive prompt with all task details', async () => {
        const detailedRequest: ClassificationRequest = {
          taskId: 'task-456',
          content: 'Buy groceries for dinner party',
          description: 'Need to get ingredients for Italian cuisine: pasta, tomatoes, cheese',
          availableLabels: ['shopping', 'food', 'social'],
        };

        const mockResponse = {
          content: [{ type: 'text', text: '["shopping", "food"]' }],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

        await classifier.classifyTask(detailedRequest);

        const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
        const prompt = promptCall.messages[0].content;

        expect(prompt).toContain('Buy groceries for dinner party');
        expect(prompt).toContain('Need to get ingredients for Italian cuisine');
        expect(prompt).toContain('shopping');
        expect(prompt).toContain('food');
        expect(prompt).toContain('social');
        expect(prompt).toContain('Select 1-5 labels');
        expect(prompt).toContain('JSON array of label names');
      });

      it('should handle edge case with empty available labels list', async () => {
        classificationRequest.availableLabels = [];

        const mockResponse = {
          content: [{ type: 'text', text: '["productivity"]' }],
        };
        mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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

        mockAnthropicClient.messages.create
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: '["productivity", "work"]' }],
          })
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: '["health"]' }],
          });

        const results = await classifier.classifyTasks(requests);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          taskId: 'task-1',
          labels: ['productivity', 'work'],
          rawResponse: '["productivity", "work"]',
        });
        expect(results[1]).toEqual({
          taskId: 'task-2',
          labels: ['health'],
          rawResponse: '["health"]',
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
        mockAnthropicClient.messages.create
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: '["productivity"]' }],
          })
          .mockRejectedValueOnce(apiError);

        const results = await classifier.classifyTasks(requests);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          taskId: 'task-1',
          labels: ['productivity'],
          rawResponse: '["productivity"]',
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
        expect(mockAnthropicClient.messages.create).not.toHaveBeenCalled();
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
        content: [{ type: 'text', text: '["productivity"]' }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await classifier.classifyTask(request);

      const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
      const prompt = promptCall.messages[0].content;

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
        content: [{ type: 'text', text: '["productivity"]' }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await classifier.classifyTask(request);

      const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
      expect(promptCall.messages[0].content).toContain(longContent);
    });

    it('should parse complex JSON responses correctly', async () => {
      const complexResponse = `
        Based on the task analysis, here are the appropriate labels:
        ["productivity", "work"]

        This task involves documentation work which falls under productivity.
      `;

      const mockResponse = {
        content: [{ type: 'text', text: complexResponse }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Write API docs',
        description: '',
        availableLabels: ['productivity', 'work', 'documentation'],
      };

      const result = await classifier.classifyTask(request);

      expect(result.labels).toEqual(['productivity', 'work']);
    });

    it('should handle nested JSON arrays in response', async () => {
      const nestedResponse = `
        {"analysis": "good task", "labels": ["productivity", "work"]}
        Also found: ["urgent"]
      `;

      const mockResponse = {
        content: [{ type: 'text', text: nestedResponse }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Urgent documentation',
        description: '',
        availableLabels: ['productivity', 'work', 'urgent'],
      };

      const result = await classifier.classifyTask(request);

      // Should pick the first valid JSON array
      expect(result.labels).toEqual(['productivity', 'work']);
    });

    it('should handle case-insensitive label matching in fallback', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: 'This task is about PRODUCTIVITY and very URGENT work',
          },
        ],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const request: ClassificationRequest = {
        taskId: 'task-123',
        content: 'Important task',
        description: '',
        availableLabels: ['productivity', 'urgent'],
      };

      const result = await classifier.classifyTask(request);

      expect(result.labels).toEqual(['productivity', 'urgent']);
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

      mockAnthropicClient.messages.create.mockRejectedValueOnce(rateLimitError);

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

      mockAnthropicClient.messages.create.mockRejectedValue(authError);

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
        content: [{ type: 'text', text: JSON.stringify(manyLabels.slice(0, 3)) }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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
        content: [{ type: 'text', text: '["工作", "émojis🚀"]' }],
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await classifier.classifyTask(request);

      expect(result.labels).toEqual(['工作', 'émojis🚀']);
    });
  });
});