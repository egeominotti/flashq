/**
 * TCP protocol module exports.
 */
export {
  type PendingRequest,
  JsonBufferHandler,
  BinaryBufferHandler,
  encodeCommand,
  parseJsonResponse,
  generateRequestId,
  resetRequestIdCounter,
} from './handler';
