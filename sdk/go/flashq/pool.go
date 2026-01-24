package flashq

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vmihailenco/msgpack/v5"
)

var (
	bufferPool = sync.Pool{New: func() interface{} { return make([]byte, 0, 4096) }}
	mapPool    = sync.Pool{New: func() interface{} { return make(map[string]interface{}, 8) }}
)

// PooledConnection is a single connection in the pool with health tracking.
type PooledConnection struct {
	conn      net.Conn
	reader    *bufio.Reader
	writer    *bufio.Writer
	mu        sync.Mutex
	healthy   atomic.Bool
	lastUse   atomic.Int64
	lastCheck atomic.Int64
	failures  atomic.Int32
}

func (pc *PooledConnection) isHealthy() bool { return pc.healthy.Load() }
func (pc *PooledConnection) markHealthy()    { pc.healthy.Store(true); pc.failures.Store(0) }
func (pc *PooledConnection) markUnhealthy()  { pc.healthy.Store(false); pc.failures.Add(1) }

// ConnectionPool manages multiple connections with auto-reconnect.
type ConnectionPool struct {
	opts        ClientOptions
	connections []*PooledConnection
	size        int
	index       atomic.Uint64
	mu          sync.RWMutex
	connected   atomic.Bool
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup

	// Metrics
	totalReconnects atomic.Int64
	totalFailures   atomic.Int64
}

// NewConnectionPool creates a pool with specified size.
func NewConnectionPool(opts ClientOptions, size int) *ConnectionPool {
	if size < 1 {
		size = 4
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &ConnectionPool{opts: opts, connections: make([]*PooledConnection, size), size: size, ctx: ctx, cancel: cancel}
}

// Connect establishes all connections in the pool.
func (p *ConnectionPool) Connect(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.connected.Load() {
		return nil
	}

	for i := 0; i < p.size; i++ {
		pc, err := p.createConnection(ctx)
		if err != nil {
			p.closeAllLocked()
			return err
		}
		p.connections[i] = pc
	}

	p.connected.Store(true)

	// Start health checker
	p.wg.Add(1)
	go p.healthChecker()

	return nil
}

func (p *ConnectionPool) createConnection(ctx context.Context) (*PooledConnection, error) {
	addr := fmt.Sprintf("%s:%d", p.opts.Host, p.opts.Port)
	dialer := net.Dialer{Timeout: p.opts.ConnectTimeout}

	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, NewConnectionError("failed to connect", err)
	}

	if tc, ok := conn.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
		tc.SetKeepAlive(true)
		tc.SetKeepAlivePeriod(30 * time.Second)
		tc.SetWriteBuffer(65536)
		tc.SetReadBuffer(65536)
	}

	pc := &PooledConnection{
		conn:   conn,
		reader: bufio.NewReaderSize(conn, 65536),
		writer: bufio.NewWriterSize(conn, 65536),
	}
	pc.healthy.Store(true)
	pc.lastUse.Store(time.Now().UnixNano())

	if p.opts.Token != "" {
		if err := p.authConn(pc); err != nil {
			conn.Close()
			return nil, err
		}
	}

	return pc, nil
}

func (p *ConnectionPool) authConn(pc *PooledConnection) error {
	resp, err := p.sendOnConn(pc, map[string]interface{}{"cmd": "AUTH", "token": p.opts.Token}, p.opts.Timeout)
	if err != nil {
		return err
	}
	if success, ok := resp["success"].(bool); !ok || !success {
		return NewAuthenticationError("authentication failed")
	}
	return nil
}

// healthChecker periodically checks and reconnects unhealthy connections.
func (p *ConnectionPool) healthChecker() {
	defer p.wg.Done()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.checkAndReconnect()
		}
	}
}

func (p *ConnectionPool) checkAndReconnect() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i, pc := range p.connections {
		if pc == nil || !pc.isHealthy() || pc.failures.Load() > 0 {
			// Try to reconnect
			if pc != nil && pc.conn != nil {
				pc.conn.Close()
			}
			newPc, err := p.createConnection(p.ctx)
			if err == nil {
				p.connections[i] = newPc
				p.totalReconnects.Add(1)
			}
		}
	}
}

// reconnectConn attempts to reconnect a specific connection with backoff.
func (p *ConnectionPool) reconnectConn(idx int) {
	p.mu.Lock()
	defer p.mu.Unlock()

	pc := p.connections[idx]
	if pc != nil && pc.conn != nil {
		pc.conn.Close()
	}

	// Exponential backoff
	maxAttempts := p.opts.MaxReconnectAttempts
	if maxAttempts == 0 {
		maxAttempts = 10
	}
	delay := p.opts.ReconnectDelay
	if delay == 0 {
		delay = time.Second
	}
	maxDelay := p.opts.MaxReconnectDelay
	if maxDelay == 0 {
		maxDelay = 30 * time.Second
	}

	for attempt := 0; attempt < maxAttempts; attempt++ {
		select {
		case <-p.ctx.Done():
			return
		default:
		}

		newPc, err := p.createConnection(p.ctx)
		if err == nil {
			p.connections[idx] = newPc
			p.totalReconnects.Add(1)
			return
		}

		p.totalFailures.Add(1)
		time.Sleep(delay)
		delay *= 2
		if delay > maxDelay {
			delay = maxDelay
		}
	}
}

// Close closes all connections.
func (p *ConnectionPool) Close() error {
	p.cancel()
	p.wg.Wait()

	p.mu.Lock()
	defer p.mu.Unlock()
	p.connected.Store(false)
	return p.closeAllLocked()
}

func (p *ConnectionPool) closeAllLocked() error {
	var lastErr error
	for i, pc := range p.connections {
		if pc != nil && pc.conn != nil {
			if err := pc.conn.Close(); err != nil {
				lastErr = err
			}
			p.connections[i] = nil
		}
	}
	return lastErr
}

// IsConnected returns pool status.
func (p *ConnectionPool) IsConnected() bool { return p.connected.Load() }

// Stats returns pool statistics.
func (p *ConnectionPool) Stats() (reconnects, failures int64, healthy int) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, pc := range p.connections {
		if pc != nil && pc.isHealthy() {
			healthy++
		}
	}
	return p.totalReconnects.Load(), p.totalFailures.Load(), healthy
}

// getConn gets next healthy connection (round-robin with fallback).
func (p *ConnectionPool) getConn() (*PooledConnection, int) {
	start := p.index.Add(1)
	for i := 0; i < p.size; i++ {
		idx := int((start + uint64(i)) % uint64(p.size))
		pc := p.connections[idx]
		if pc != nil && pc.isHealthy() {
			return pc, idx
		}
	}
	// Return any connection as fallback
	idx := int(start % uint64(p.size))
	return p.connections[idx], idx
}

// Send sends command on next available connection with auto-retry.
func (p *ConnectionPool) Send(cmd map[string]interface{}, timeout time.Duration) (map[string]interface{}, error) {
	if !p.connected.Load() {
		return nil, NewConnectionError("not connected", nil)
	}

	pc, idx := p.getConn()
	if pc == nil {
		return nil, NewConnectionError("no available connections", nil)
	}

	resp, err := p.sendOnConn(pc, cmd, timeout)
	if err != nil {
		pc.markUnhealthy()
		// Try reconnect in background
		go p.reconnectConn(idx)
		// Retry on another connection
		pc2, _ := p.getConn()
		if pc2 != nil && pc2 != pc {
			return p.sendOnConn(pc2, cmd, timeout)
		}
		return nil, err
	}

	pc.markHealthy()
	return resp, nil
}

func (p *ConnectionPool) sendOnConn(pc *PooledConnection, cmd map[string]interface{}, timeout time.Duration) (map[string]interface{}, error) {
	pc.mu.Lock()
	defer pc.mu.Unlock()

	if pc.conn == nil {
		return nil, NewConnectionError("connection closed", nil)
	}

	if timeout > 0 {
		pc.conn.SetDeadline(time.Now().Add(timeout))
		defer pc.conn.SetDeadline(time.Time{})
	}

	if p.opts.UseBinary {
		return p.sendBinaryOnConn(pc, cmd)
	}
	return p.sendJSONOnConn(pc, cmd)
}

// sendJSONOnConn sends command using JSON newline-delimited protocol.
func (p *ConnectionPool) sendJSONOnConn(pc *PooledConnection, cmd map[string]interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, NewValidationError(fmt.Sprintf("marshal error: %v", err))
	}

	buf := bufferPool.Get().([]byte)[:0]
	buf = append(buf, data...)
	buf = append(buf, '\n')
	_, err = pc.writer.Write(buf)
	bufferPool.Put(buf[:0])

	if err != nil {
		return nil, NewConnectionError("write error", err)
	}
	if err := pc.writer.Flush(); err != nil {
		return nil, NewConnectionError("flush error", err)
	}

	line, err := pc.reader.ReadBytes('\n')
	if err != nil {
		return nil, NewConnectionError("read error", err)
	}

	resp := mapPool.Get().(map[string]interface{})
	for k := range resp {
		delete(resp, k)
	}
	if err := json.Unmarshal(line, &resp); err != nil {
		mapPool.Put(resp)
		return nil, NewServerError(fmt.Sprintf("parse error: %v", err), 0)
	}
	if errMsg, ok := resp["error"].(string); ok && errMsg != "" {
		mapPool.Put(resp)
		return nil, NewServerError(errMsg, 0)
	}

	pc.lastUse.Store(time.Now().UnixNano())
	return resp, nil
}

// sendBinaryOnConn sends command using MessagePack binary protocol.
// Protocol: 4-byte big-endian length prefix + msgpack data
func (p *ConnectionPool) sendBinaryOnConn(pc *PooledConnection, cmd map[string]interface{}) (map[string]interface{}, error) {
	// Encode command with msgpack
	data, err := msgpack.Marshal(cmd)
	if err != nil {
		return nil, NewValidationError(fmt.Sprintf("msgpack marshal error: %v", err))
	}

	// Write 4-byte length prefix (big-endian) + data
	lenBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lenBuf, uint32(len(data)))

	if _, err := pc.writer.Write(lenBuf); err != nil {
		return nil, NewConnectionError("write length error", err)
	}
	if _, err := pc.writer.Write(data); err != nil {
		return nil, NewConnectionError("write data error", err)
	}
	if err := pc.writer.Flush(); err != nil {
		return nil, NewConnectionError("flush error", err)
	}

	// Read 4-byte length prefix
	respLenBuf := make([]byte, 4)
	if _, err := io.ReadFull(pc.reader, respLenBuf); err != nil {
		return nil, NewConnectionError("read length error", err)
	}
	respLen := binary.BigEndian.Uint32(respLenBuf)

	// Sanity check: max 100MB response
	if respLen > 100*1024*1024 {
		return nil, NewServerError(fmt.Sprintf("response too large: %d bytes", respLen), 0)
	}

	// Read msgpack data
	respData := make([]byte, respLen)
	if _, err := io.ReadFull(pc.reader, respData); err != nil {
		return nil, NewConnectionError("read data error", err)
	}

	// Decode response
	resp := mapPool.Get().(map[string]interface{})
	for k := range resp {
		delete(resp, k)
	}
	if err := msgpack.Unmarshal(respData, &resp); err != nil {
		mapPool.Put(resp)
		return nil, NewServerError(fmt.Sprintf("msgpack parse error: %v", err), 0)
	}
	if errMsg, ok := resp["error"].(string); ok && errMsg != "" {
		mapPool.Put(resp)
		return nil, NewServerError(errMsg, 0)
	}

	pc.lastUse.Store(time.Now().UnixNano())
	return resp, nil
}
