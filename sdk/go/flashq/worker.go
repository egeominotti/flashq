package flashq

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// JobProcessor is a function that processes a job and returns a result.
type JobProcessor func(job *Job) (interface{}, error)

// WorkerEventHandler handles worker events.
// Events that involve jobs include the workerID (processor goroutine index).
type WorkerEventHandler struct {
	OnReady     func()
	OnActive    func(job *Job, workerID int)
	OnCompleted func(job *Job, result interface{}, workerID int)
	OnFailed    func(job *Job, err error, workerID int)
	OnError     func(err error)
	OnStopping  func()
	OnStopped   func()
}

// Worker processes jobs from one or more queues with high performance.
type Worker struct {
	queues     []string
	processor  JobProcessor
	clientOpts ClientOptions
	workerOpts WorkerOptions
	events     WorkerEventHandler

	state      atomic.Int32
	client     *Client // Single shared client with pool
	wg         sync.WaitGroup
	ctx        context.Context
	cancel     context.CancelFunc
	processing atomic.Int32
	processed  atomic.Int64
	failed     atomic.Int64
	jobChan    chan *Job // Channel for job distribution
	logger     *log.Logger
}

// NewWorker creates a new high-performance worker.
func NewWorker(queues []string, processor JobProcessor, clientOpts *ClientOptions, workerOpts *WorkerOptions) *Worker {
	co := DefaultClientOptions()
	if clientOpts != nil {
		co = *clientOpts
	}
	wo := DefaultWorkerOptions()
	if workerOpts != nil {
		wo = *workerOpts
	}
	// Larger pool for workers
	if co.PoolSize < wo.Concurrency/2 {
		co.PoolSize = wo.Concurrency/2 + 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Worker{
		queues: queues, processor: processor, clientOpts: co, workerOpts: wo,
		ctx: ctx, cancel: cancel, logger: log.Default(),
	}
}

// NewWorkerSingle creates a worker for a single queue.
func NewWorkerSingle(queue string, processor JobProcessor, clientOpts *ClientOptions, workerOpts *WorkerOptions) *Worker {
	return NewWorker([]string{queue}, processor, clientOpts, workerOpts)
}

// State returns the current worker state.
func (w *Worker) State() WorkerState { return WorkerState(w.state.Load()) }

// Processing returns jobs currently being processed.
func (w *Worker) Processing() int { return int(w.processing.Load()) }

// Processed returns total jobs processed.
func (w *Worker) Processed() int64 { return w.processed.Load() }

// Failed returns total failed jobs.
func (w *Worker) Failed() int64 { return w.failed.Load() }

// On registers event handlers.
// For active/completed/failed events, handler signature includes workerID.
func (w *Worker) On(event string, handler interface{}) *Worker {
	switch event {
	case "ready":
		if h, ok := handler.(func()); ok { w.events.OnReady = h }
	case "active":
		if h, ok := handler.(func(job *Job, workerID int)); ok { w.events.OnActive = h }
	case "completed":
		if h, ok := handler.(func(job *Job, result interface{}, workerID int)); ok { w.events.OnCompleted = h }
	case "failed":
		if h, ok := handler.(func(job *Job, err error, workerID int)); ok { w.events.OnFailed = h }
	case "error":
		if h, ok := handler.(func(err error)); ok { w.events.OnError = h }
	case "stopping":
		if h, ok := handler.(func()); ok { w.events.OnStopping = h }
	case "stopped":
		if h, ok := handler.(func()); ok { w.events.OnStopped = h }
	}
	return w
}

// Start starts the worker.
func (w *Worker) Start(ctx context.Context) error {
	if w.State() != WorkerStateIdle { return nil }
	w.state.Store(int32(WorkerStateStarting))
	w.logInfo("Starting worker", "queues", w.queues)

	concurrency := w.workerOpts.Concurrency
	if concurrency < 1 { concurrency = 1 }

	// Single shared client with larger pool
	w.client = NewWithOptions(w.clientOpts)
	if err := w.client.Connect(ctx); err != nil {
		w.state.Store(int32(WorkerStateIdle))
		return fmt.Errorf("failed to connect: %w", err)
	}

	// Job channel for distribution
	w.jobChan = make(chan *Job, concurrency*2)

	// Start puller goroutines (fewer than workers)
	pullers := len(w.queues)
	if pullers > 4 { pullers = 4 }
	for i := 0; i < pullers; i++ {
		w.wg.Add(1)
		go w.pullerLoop(i)
	}

	// Start processor goroutines
	for i := 0; i < concurrency; i++ {
		w.wg.Add(1)
		go w.processorLoop(i)
	}

	w.state.Store(int32(WorkerStateRunning))
	w.logInfo("Worker started", "concurrency", concurrency)
	if w.events.OnReady != nil { w.events.OnReady() }
	return nil
}

// pullerLoop pulls jobs and distributes to processors.
func (w *Worker) pullerLoop(id int) {
	defer w.wg.Done()
	batchSize := w.workerOpts.BatchSize
	if batchSize < 1 { batchSize = 100 }
	pullTimeout := 5 * time.Second
	queueIdx := id

	for {
		select {
		case <-w.ctx.Done():
			return
		default:
		}
		queue := w.queues[queueIdx%len(w.queues)]
		queueIdx++

		jobs, err := w.client.PullBatch(queue, batchSize, pullTimeout)
		if err != nil {
			if w.events.OnError != nil { w.events.OnError(err) }
			select {
			case <-w.ctx.Done(): return
			case <-time.After(50 * time.Millisecond):
			}
			continue
		}
		for _, job := range jobs {
			select {
			case <-w.ctx.Done(): return
			case w.jobChan <- job:
			}
		}
	}
}

// processorLoop processes jobs from channel.
func (w *Worker) processorLoop(workerID int) {
	defer w.wg.Done()
	for {
		select {
		case <-w.ctx.Done():
			return
		case job := <-w.jobChan:
			if job == nil { return }
			w.processJob(job, workerID)
		}
	}
}

func (w *Worker) processJob(job *Job, workerID int) {
	w.processing.Add(1)
	defer w.processing.Add(-1)

	if w.events.OnActive != nil { w.events.OnActive(job, workerID) }

	result, err := w.processor(job)

	if err != nil {
		w.failed.Add(1)
		w.client.Fail(job.ID, err.Error())
		if w.events.OnFailed != nil { w.events.OnFailed(job, err, workerID) }
		return
	}

	w.client.Ack(job.ID, result)
	w.processed.Add(1)
	if w.events.OnCompleted != nil { w.events.OnCompleted(job, result, workerID) }
}

// Stop stops the worker gracefully.
func (w *Worker) Stop(ctx context.Context) error { return w.stop(ctx, false) }

// ForceStop stops the worker immediately.
func (w *Worker) ForceStop() error { return w.stop(context.Background(), true) }

func (w *Worker) stop(ctx context.Context, force bool) error {
	state := w.State()
	if state == WorkerStateStopping || state == WorkerStateStopped { return nil }

	w.state.Store(int32(WorkerStateStopping))
	w.logInfo("Stopping worker", "force", force)
	if w.events.OnStopping != nil { w.events.OnStopping() }

	w.cancel()
	close(w.jobChan)

	if !force {
		done := make(chan struct{})
		go func() { w.wg.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done(): w.logWarn("Timeout waiting for workers")
		case <-time.After(w.workerOpts.CloseTimeout): w.logWarn("Timeout waiting for workers")
		}
	}

	if w.client != nil { w.client.Close() }
	w.state.Store(int32(WorkerStateStopped))
	w.logInfo("Worker stopped", "processed", w.Processed(), "failed", w.Failed())
	if w.events.OnStopped != nil { w.events.OnStopped() }
	return nil
}

// Wait blocks until the worker stops.
func (w *Worker) Wait() { w.wg.Wait() }

func (w *Worker) logInfo(msg string, args ...interface{}) {
	if w.workerOpts.LogLevel <= LogLevelInfo { w.logger.Printf("[INFO] Worker: %s %v\n", msg, args) }
}
func (w *Worker) logWarn(msg string, args ...interface{}) {
	if w.workerOpts.LogLevel <= LogLevelWarn { w.logger.Printf("[WARN] Worker: %s %v\n", msg, args) }
}
func (w *Worker) logError(msg string, args ...interface{}) {
	if w.workerOpts.LogLevel <= LogLevelError { w.logger.Printf("[ERROR] Worker: %s %v\n", msg, args) }
}
