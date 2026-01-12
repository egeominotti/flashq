<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Base exception for FlashQ errors
 */
class FlashQException extends \Exception {}

/**
 * Connection error
 */
class ConnectionException extends FlashQException {}

/**
 * Timeout error
 */
class TimeoutException extends FlashQException {}

/**
 * Authentication error
 */
class AuthenticationException extends FlashQException {}
