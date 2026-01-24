/**
 * TCP protocol module exports.
 */
export {
  type PendingRequest,
  JsonBufferHandler,
  BinaryBufferHandler,
  RequestIdGenerator,
  encodeCommand,
  parseJsonResponse,
  generateRequestId,
  resetRequestIdCounter,
} from './handler';
