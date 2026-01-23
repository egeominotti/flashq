/**
 * Logger utility tests
 */
import { describe, it, expect } from 'bun:test';
import { Logger, createLogger, getLogger, setGlobalLogger } from '../../src/utils/logger';

describe('Logger', () => {
  describe('log levels', () => {
    it('should respect log level hierarchy', () => {
      const logs: string[] = [];
      const logger = new Logger({
        level: 'info',
        handler: (entry) => logs.push(`${entry.level}: ${entry.message}`),
      });

      logger.trace('trace message');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(logs).toEqual(['info: info message', 'warn: warn message', 'error: error message']);
    });

    it('should log nothing when level is silent', () => {
      const logs: string[] = [];
      const logger = new Logger({
        level: 'silent',
        handler: (entry) => logs.push(entry.message),
      });

      logger.trace('test');
      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      expect(logs).toEqual([]);
    });

    it('should log everything when level is trace', () => {
      const logs: string[] = [];
      const logger = new Logger({
        level: 'trace',
        handler: (entry) => logs.push(entry.level),
      });

      logger.trace('test');
      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      expect(logs).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
    });
  });

  describe('log entries', () => {
    it('should include timestamp when enabled', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        timestamps: true,
        handler: (e) => {
          entry = e;
        },
      });

      logger.info('test');

      expect(entry.timestamp).toBeTruthy();
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should exclude timestamp when disabled', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        timestamps: false,
        handler: (e) => {
          entry = e;
        },
      });

      logger.info('test');

      expect(entry.timestamp).toBe('');
    });

    it('should include prefix', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        prefix: 'myapp',
        handler: (e) => {
          entry = e;
        },
      });

      logger.info('test');

      expect(entry.prefix).toBe('myapp');
    });

    it('should include data', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        handler: (e) => {
          entry = e;
        },
      });

      logger.info('test', { foo: 'bar' });

      expect(entry.data).toEqual({ foo: 'bar' });
    });
  });

  describe('child logger', () => {
    it('should create child with extended prefix', () => {
      let entry: any = null;
      const parent = new Logger({
        level: 'info',
        prefix: 'parent',
        handler: (e) => {
          entry = e;
        },
      });

      const child = parent.child('child');
      child.info('test');

      expect(entry.prefix).toBe('parent:child');
    });

    it('should inherit log level', () => {
      const logs: string[] = [];
      const parent = new Logger({
        level: 'warn',
        handler: (e) => logs.push(e.message),
      });

      const child = parent.child('child');
      child.info('info');
      child.warn('warn');

      expect(logs).toEqual(['warn']);
    });
  });

  describe('request ID tracking', () => {
    it('should include request ID in log entries', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        handler: (e) => {
          entry = e;
        },
      });

      logger.setRequestId('req-123');
      logger.info('test');

      expect(entry.requestId).toBe('req-123');
    });

    it('should clear request ID', () => {
      let entry: any = null;
      const logger = new Logger({
        level: 'info',
        handler: (e) => {
          entry = e;
        },
      });

      logger.setRequestId('req-123');
      logger.clearRequestId();
      logger.info('test');

      expect(entry.requestId).toBeUndefined();
    });

    it('should propagate request ID to child', () => {
      let entry: any = null;
      const parent = new Logger({
        level: 'info',
        handler: (e) => {
          entry = e;
        },
      });

      parent.setRequestId('req-456');
      const child = parent.child('child');
      child.info('test');

      expect(entry.requestId).toBe('req-456');
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      const logs: string[] = [];
      const logger = new Logger({
        level: 'error',
        handler: (e) => logs.push(e.message),
      });

      logger.info('before');
      logger.setLevel('info');
      logger.info('after');

      expect(logs).toEqual(['after']);
    });
  });

  describe('isLevelEnabled', () => {
    it('should return true for enabled levels', () => {
      const logger = new Logger({ level: 'info' });

      expect(logger.isLevelEnabled('trace')).toBe(false);
      expect(logger.isLevelEnabled('debug')).toBe(false);
      expect(logger.isLevelEnabled('info')).toBe(true);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('error')).toBe(true);
    });
  });

  describe('getLevelName', () => {
    it('should return current level name', () => {
      const logger = new Logger({ level: 'warn' });
      expect(logger.getLevelName()).toBe('warn');
    });
  });

  describe('global logger', () => {
    it('should provide global logger instance', () => {
      const logger = getLogger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should allow setting global logger', () => {
      const custom = createLogger({ level: 'debug', prefix: 'custom' });
      setGlobalLogger(custom);

      const global = getLogger();
      expect(global.getLevelName()).toBe('debug');
    });
  });

  describe('createLogger', () => {
    it('should create logger with options', () => {
      const logger = createLogger({
        level: 'debug',
        prefix: 'test',
        timestamps: false,
      });

      expect(logger).toBeInstanceOf(Logger);
      expect(logger.getLevelName()).toBe('debug');
    });
  });
});
