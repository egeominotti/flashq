package flashq

import (
	"fmt"
)

// FlashQError is the base error type for all flashQ errors.
type FlashQError struct {
	Message string
	Cause   error
}

func (e *FlashQError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *FlashQError) Unwrap() error {
	return e.Cause
}

// ConnectionError indicates a connection failure.
type ConnectionError struct {
	FlashQError
}

// NewConnectionError creates a new connection error.
func NewConnectionError(message string, cause error) *ConnectionError {
	return &ConnectionError{FlashQError{Message: message, Cause: cause}}
}

// AuthenticationError indicates authentication failure.
type AuthenticationError struct {
	FlashQError
}

// NewAuthenticationError creates a new authentication error.
func NewAuthenticationError(message string) *AuthenticationError {
	return &AuthenticationError{FlashQError{Message: message}}
}

// TimeoutError indicates a timeout occurred.
type TimeoutError struct {
	FlashQError
}

// NewTimeoutError creates a new timeout error.
func NewTimeoutError(message string) *TimeoutError {
	return &TimeoutError{FlashQError{Message: message}}
}

// ValidationError indicates invalid input.
type ValidationError struct {
	FlashQError
}

// NewValidationError creates a new validation error.
func NewValidationError(message string) *ValidationError {
	return &ValidationError{FlashQError{Message: message}}
}

// ServerError indicates a server-side error.
type ServerError struct {
	FlashQError
	Code int
}

// NewServerError creates a new server error.
func NewServerError(message string, code int) *ServerError {
	return &ServerError{FlashQError: FlashQError{Message: message}, Code: code}
}

// JobNotFoundError indicates job was not found.
type JobNotFoundError struct {
	FlashQError
	JobID int64
}

// NewJobNotFoundError creates a new job not found error.
func NewJobNotFoundError(jobID int64) *JobNotFoundError {
	return &JobNotFoundError{
		FlashQError: FlashQError{Message: fmt.Sprintf("job not found: %d", jobID)},
		JobID:       jobID,
	}
}

// QueueNotFoundError indicates queue was not found.
type QueueNotFoundError struct {
	FlashQError
	Queue string
}

// NewQueueNotFoundError creates a new queue not found error.
func NewQueueNotFoundError(queue string) *QueueNotFoundError {
	return &QueueNotFoundError{
		FlashQError: FlashQError{Message: fmt.Sprintf("queue not found: %s", queue)},
		Queue:       queue,
	}
}

// DuplicateJobError indicates a duplicate job was attempted.
type DuplicateJobError struct {
	FlashQError
	UniqueKey string
}

// NewDuplicateJobError creates a new duplicate job error.
func NewDuplicateJobError(uniqueKey string) *DuplicateJobError {
	return &DuplicateJobError{
		FlashQError: FlashQError{Message: fmt.Sprintf("duplicate job with key: %s", uniqueKey)},
		UniqueKey:   uniqueKey,
	}
}

// QueuePausedError indicates the queue is paused.
type QueuePausedError struct {
	FlashQError
	Queue string
}

// NewQueuePausedError creates a new queue paused error.
func NewQueuePausedError(queue string) *QueuePausedError {
	return &QueuePausedError{
		FlashQError: FlashQError{Message: fmt.Sprintf("queue is paused: %s", queue)},
		Queue:       queue,
	}
}

// RateLimitError indicates rate limit was exceeded.
type RateLimitError struct {
	FlashQError
	Queue string
}

// NewRateLimitError creates a new rate limit error.
func NewRateLimitError(queue string) *RateLimitError {
	return &RateLimitError{
		FlashQError: FlashQError{Message: fmt.Sprintf("rate limit exceeded for queue: %s", queue)},
		Queue:       queue,
	}
}

// ConcurrencyLimitError indicates concurrency limit was reached.
type ConcurrencyLimitError struct {
	FlashQError
	Queue string
}

// NewConcurrencyLimitError creates a new concurrency limit error.
func NewConcurrencyLimitError(queue string) *ConcurrencyLimitError {
	return &ConcurrencyLimitError{
		FlashQError: FlashQError{Message: fmt.Sprintf("concurrency limit reached for queue: %s", queue)},
		Queue:       queue,
	}
}
