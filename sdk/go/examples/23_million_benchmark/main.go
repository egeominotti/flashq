// Example 23: Million Jobs Benchmark
//
// Engineering benchmark with metrics:
// - 1 million jobs processing
// - Latency percentiles (P50/P95/P99/P99.9)
// - Memory tracking (client and server)
// - Multiple runs for stability testing
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

const (
	totalJobs       = 1_000_000
	batchSize       = 1000
	numWorkers      = 16
	concurrency     = 100
	numRuns         = 3
	serverHTTPPort  = 6790
	maxLatencySamples = 100_000
)

type LatencyTracker struct {
	samples []float64
	count   int64
	sum     float64
	min     float64
	max     float64
	mu      sync.Mutex
}

func NewLatencyTracker() *LatencyTracker {
	return &LatencyTracker{samples: make([]float64, 0, maxLatencySamples), min: math.MaxFloat64, max: -math.MaxFloat64}
}

func (t *LatencyTracker) Add(latencyMs float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.count++
	t.sum += latencyMs
	if latencyMs < t.min { t.min = latencyMs }
	if latencyMs > t.max { t.max = latencyMs }
	if len(t.samples) < maxLatencySamples {
		t.samples = append(t.samples, latencyMs)
	}
}

func (t *LatencyTracker) GetStats() (p50, p95, p99, p999, avg, min, max float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.samples) == 0 { return }
	sorted := make([]float64, len(t.samples))
	copy(sorted, t.samples)
	sort.Float64s(sorted)
	percentile := func(p float64) float64 {
		idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
		if idx < 0 { idx = 0 }
		return sorted[idx]
	}
	return percentile(50), percentile(95), percentile(99), percentile(99.9), t.sum / float64(t.count), t.min, t.max
}

type RunResult struct {
	Run         int
	PushTime    time.Duration
	PushRate    int
	ProcessTime time.Duration
	ProcessRate int
	Processed   int64
	Errors      int64
	Success     bool
	P50, P95, P99, P999, AvgLatency, MaxLatency float64
	PeakMemMB   float64
	ServerMemMB float64
}

func getMemoryMB() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.Alloc) / 1024 / 1024
}

func getServerMemory() float64 {
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/system/metrics", serverHTTPPort))
	if err != nil { return 0 }
	defer resp.Body.Close()
	var data struct { Ok bool `json:"ok"`; Data struct { MemoryUsedMB float64 `json:"memory_used_mb"` } `json:"data"` }
	json.NewDecoder(resp.Body).Decode(&data)
	return data.Data.MemoryUsedMB
}

func formatMs(ms float64) string {
	if ms < 1 { return fmt.Sprintf("%.0fµs", ms*1000) }
	if ms < 1000 { return fmt.Sprintf("%.1fms", ms) }
	return fmt.Sprintf("%.2fs", ms/1000)
}

func formatNum(n int64) string {
	if n >= 1_000_000 { return fmt.Sprintf("%.2fM", float64(n)/1_000_000) }
	if n >= 1_000 { return fmt.Sprintf("%.1fK", float64(n)/1_000) }
	return fmt.Sprintf("%d", n)
}

func formatRate(n int) string {
	if n >= 1_000_000 { return fmt.Sprintf("%.2fM/s", float64(n)/1_000_000) }
	if n >= 1_000 { return fmt.Sprintf("%.1fK/s", float64(n)/1_000) }
	return fmt.Sprintf("%d/s", n)
}

func runBenchmark(runNum int) RunResult {
	ctx := context.Background()
	fmt.Printf("\n%s\n🚀 RUN %d/%d - %s Jobs\n%s\n", strings.Repeat("=", 70), runNum, numRuns, formatNum(totalJobs), strings.Repeat("=", 70))

	client := flashq.New()
	client.Connect(ctx)
	client.Obliterate("million-benchmark")

	latencyTracker := NewLatencyTracker()
	var processed, errors int64
	var peakMem float64
	startTimes := sync.Map{}

	// Start workers
	workers := make([]*flashq.Worker, numWorkers)
	for i := 0; i < numWorkers; i++ {
		opts := flashq.DefaultWorkerOptions()
		opts.Concurrency = concurrency / numWorkers
		opts.AutoStart = false
		opts.BatchSize = 100

		workers[i] = flashq.NewWorkerSingle("million-benchmark", func(job *flashq.Job) (interface{}, error) {
			if st, ok := startTimes.Load(job.ID); ok {
				latencyTracker.Add(float64(time.Since(st.(time.Time)).Microseconds()) / 1000)
			}
			return nil, nil
		}, nil, &opts)

		workers[i].On("completed", func(job *flashq.Job, result interface{}) {
			atomic.AddInt64(&processed, 1)
		})
		workers[i].On("failed", func(job *flashq.Job, err error) {
			atomic.AddInt64(&errors, 1)
		})
		workers[i].Start(ctx)
	}
	fmt.Printf("✅ %d workers started (total concurrency: %d)\n", numWorkers, concurrency)

	// Push jobs
	fmt.Printf("📤 Pushing %s jobs in batches of %d...\n", formatNum(totalJobs), batchSize)
	pushStart := time.Now()

	for i := 0; i < totalJobs; i += batchSize {
		count := batchSize
		if i+count > totalJobs { count = totalJobs - i }
		jobs := make([]map[string]interface{}, count)
		pushTime := time.Now()
		for j := 0; j < count; j++ {
			jobs[j] = map[string]interface{}{"data": map[string]interface{}{"index": i + j}}
		}
		result, _ := client.PushBatch("million-benchmark", jobs)
		for _, id := range result.JobIDs {
			startTimes.Store(id, pushTime)
		}
	}
	pushTime := time.Since(pushStart)
	pushRate := int(float64(totalJobs) / pushTime.Seconds())
	fmt.Printf("✅ Push complete: %s (%.2fs)\n", formatRate(pushRate), pushTime.Seconds())

	// Wait for processing
	processStart := time.Now()
	lastReport := time.Now()
	for atomic.LoadInt64(&processed)+atomic.LoadInt64(&errors) < int64(totalJobs) {
		time.Sleep(100 * time.Millisecond)
		mem := getMemoryMB()
		if mem > peakMem { peakMem = mem }
		if time.Since(lastReport) > 5*time.Second {
			p := atomic.LoadInt64(&processed)
			rate := int(float64(p) / time.Since(processStart).Seconds())
			fmt.Printf("   %s/%s (%.1f%%) | %s | Mem: %.0fMB\n", formatNum(p), formatNum(totalJobs), float64(p)/float64(totalJobs)*100, formatRate(rate), mem)
			lastReport = time.Now()
		}
	}
	processTime := time.Since(processStart)
	processRate := int(float64(totalJobs) / processTime.Seconds())

	// Stop workers
	for _, w := range workers { w.Stop(ctx) }
	client.Obliterate("million-benchmark")
	client.Close()

	p50, p95, p99, p999, avg, _, max := latencyTracker.GetStats()
	serverMem := getServerMemory()
	success := errors == 0 && processed == int64(totalJobs)

	fmt.Printf("\n%s\n📊 Run %d Summary\n%s\n", strings.Repeat("─", 70), runNum, strings.Repeat("─", 70))
	fmt.Printf("   Throughput: Push %s | Process %s\n", formatRate(pushRate), formatRate(processRate))
	fmt.Printf("   Latency E2E: P50=%s P95=%s P99=%s P99.9=%s\n", formatMs(p50), formatMs(p95), formatMs(p99), formatMs(p999))
	fmt.Printf("   Memory: Client=%.0fMB | Server=%.0fMB\n", peakMem, serverMem)
	fmt.Printf("   Status: %s\n", map[bool]string{true: "✅ PASS", false: "❌ FAIL"}[success])

	return RunResult{Run: runNum, PushTime: pushTime, PushRate: pushRate, ProcessTime: processTime, ProcessRate: processRate,
		Processed: processed, Errors: errors, Success: success, P50: p50, P95: p95, P99: p99, P999: p999,
		AvgLatency: avg, MaxLatency: max, PeakMemMB: peakMem, ServerMemMB: serverMem}
}

func main() {
	fmt.Printf("%s\n🚀 flashQ GO MILLION BENCHMARK\n%s\n", strings.Repeat("=", 70), strings.Repeat("=", 70))
	fmt.Printf("Jobs per run: %s\nTotal jobs: %s\nWorkers: %d\nConcurrency: %d\nGo: %s\n%s\n",
		formatNum(totalJobs), formatNum(int64(totalJobs*numRuns)), numWorkers, concurrency, runtime.Version(), strings.Repeat("=", 70))

	results := make([]RunResult, numRuns)
	overallStart := time.Now()
	for i := 0; i < numRuns; i++ {
		results[i] = runBenchmark(i + 1)
		runtime.GC()
		time.Sleep(2 * time.Second)
	}
	overallTime := time.Since(overallStart)

	// Final report
	fmt.Printf("\n%s\n📊 FINAL REPORT\n%s\n", strings.Repeat("═", 70), strings.Repeat("═", 70))
	fmt.Println("│ Run │ Push Rate  │ Process Rate │ P99 Latency │ Memory │ Status │")
	fmt.Println("├─────┼────────────┼──────────────┼─────────────┼────────┼────────┤")

	var totalProcessed int64
	var sumPushRate, sumProcessRate, sumP99 float64
	var maxMem float64
	successCount := 0

	for _, r := range results {
		status := "✅"
		if !r.Success { status = "❌" }
		fmt.Printf("│ #%d  │ %9s │ %12s │ %11s │ %4.0fMB │   %s   │\n",
			r.Run, formatRate(r.PushRate), formatRate(r.ProcessRate), formatMs(r.P99), r.PeakMemMB, status)
		totalProcessed += r.Processed
		sumPushRate += float64(r.PushRate)
		sumProcessRate += float64(r.ProcessRate)
		sumP99 += r.P99
		if r.PeakMemMB > maxMem { maxMem = r.PeakMemMB }
		if r.Success { successCount++ }
	}
	fmt.Println("└─────┴────────────┴──────────────┴─────────────┴────────┴────────┘")

	avgPush := int(sumPushRate / float64(numRuns))
	avgProcess := int(sumProcessRate / float64(numRuns))
	avgP99 := sumP99 / float64(numRuns)

	fmt.Printf("\n%s\n📈 SUMMARY\n%s\n", strings.Repeat("═", 70), strings.Repeat("═", 70))
	fmt.Printf("   Total runs: %d\n", numRuns)
	fmt.Printf("   Passed: %d/%d (%.1f%%)\n", successCount, numRuns, float64(successCount)/float64(numRuns)*100)
	fmt.Printf("   Total processed: %s\n", formatNum(totalProcessed))
	fmt.Printf("   Total time: %.2f minutes\n", overallTime.Minutes())
	fmt.Printf("   Avg push rate: %s\n", formatRate(avgPush))
	fmt.Printf("   Avg process rate: %s\n", formatRate(avgProcess))
	fmt.Printf("   Avg P99 latency: %s\n", formatMs(avgP99))
	fmt.Printf("   Peak memory: %.0fMB\n", maxMem)
	fmt.Println(strings.Repeat("═", 70))

	if successCount == numRuns {
		fmt.Println("\n✅ ALL RUNS PASSED - System is stable!")
	} else {
		fmt.Printf("\n❌ %d RUNS FAILED\n", numRuns-successCount)
	}
}
