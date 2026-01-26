/**
 * Error handling utilities for MCP responses
 */

export class FlashQError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'FlashQError';
  }
}

export interface McpTextContent {
  type: 'text';
  text: string;
  [key: string]: unknown;
}

export interface McpResponse {
  content: McpTextContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export function formatError(error: unknown): McpResponse {
  if (error instanceof FlashQError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error.message,
              code: error.code || 'FLASHQ_ERROR',
              statusCode: error.statusCode,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            code: 'INTERNAL_ERROR',
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

export function formatSuccess<T>(data: T): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
