/**
 * Configuration loading from environment variables
 */

export interface FlashQConfig {
  host: string;
  httpPort: number;
  token?: string;
  timeout: number;
}

export interface Config {
  flashq: FlashQConfig;
}

export function loadConfig(): Config {
  return {
    flashq: {
      host: process.env.FLASHQ_HOST || 'localhost',
      httpPort: parseInt(process.env.FLASHQ_HTTP_PORT || '6790', 10),
      token: process.env.FLASHQ_TOKEN,
      timeout: parseInt(process.env.FLASHQ_TIMEOUT || '30000', 10),
    },
  };
}
