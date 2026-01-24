// Example 21: RAG (Retrieval Augmented Generation) Pipeline
//
// Complete RAG pipeline with:
// - Document chunking and embedding
// - Vector similarity search
// - LLM response generation
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

const (
	embedQueue    = "rag-embed"
	searchQueue   = "rag-search"
	generateQueue = "rag-generate"
)

// Simulated vector database
var (
	vectorDB   = make(map[string]vectorEntry)
	vectorDBMu sync.RWMutex
)

type vectorEntry struct {
	text      string
	embedding []float64
}

// Simulated embedding model
func embed(text string) []float64 {
	time.Sleep(10 * time.Millisecond)
	hashVal := 0
	for _, c := range text {
		hashVal += int(c)
	}
	embedding := make([]float64, 384)
	for i := range embedding {
		embedding[i] = math.Sin(float64(hashVal+i)) * 0.5
	}
	return embedding
}

// Simulated vector search
func vectorSearch(queryEmbed []float64, topK int) []string {
	time.Sleep(5 * time.Millisecond)

	vectorDBMu.RLock()
	defer vectorDBMu.RUnlock()

	results := make([]string, 0)
	i := 0
	for _, entry := range vectorDB {
		if i >= topK {
			break
		}
		results = append(results, entry.text)
		i++
	}
	return results
}

// Simulated LLM generation
func generateResponseLLM(context []string, query string) string {
	time.Sleep(50 * time.Millisecond)
	truncQuery := query
	if len(truncQuery) > 30 {
		truncQuery = truncQuery[:30]
	}
	return fmt.Sprintf("Based on %d retrieved documents about \"%s...\", the answer is: [Generated response here]",
		len(context), truncQuery)
}

func main() {
	ctx := context.Background()

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up
	client.Obliterate(embedQueue)
	client.Obliterate(searchQueue)
	client.Obliterate(generateQueue)

	fmt.Println("=== RAG Pipeline Example ===")

	// Step 1: Document Embedding Worker
	embedProcessor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		docID, _ := data["doc_id"].(string)
		text, _ := data["text"].(string)

		embedding := embed(text)

		vectorDBMu.Lock()
		vectorDB[docID] = vectorEntry{text: text, embedding: embedding}
		vectorDBMu.Unlock()

		return map[string]interface{}{
			"doc_id":     docID,
			"dimensions": len(embedding),
		}, nil
	}

	// Step 2: Search Worker
	searchProcessor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		query, _ := data["query"].(string)
		topK := 3
		if tk, ok := data["top_k"].(float64); ok {
			topK = int(tk)
		}

		queryEmbed := embed(query)
		results := vectorSearch(queryEmbed, topK)

		return map[string]interface{}{
			"query":   query,
			"results": results,
		}, nil
	}

	// Step 3: Generation Worker
	generateProcessor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		query, _ := data["query"].(string)

		context := []string{}
		if ctx, ok := data["context"].([]interface{}); ok {
			for _, c := range ctx {
				if s, ok := c.(string); ok {
					context = append(context, s)
				}
			}
		}

		response := generateResponseLLM(context, query)

		return map[string]interface{}{
			"response": response,
		}, nil
	}

	// Create workers
	embedOpts := flashq.DefaultWorkerOptions()
	embedOpts.Concurrency = 5
	embedOpts.AutoStart = false
	embedWorker := flashq.NewWorkerSingle(embedQueue, embedProcessor, nil, &embedOpts)

	searchOpts := flashq.DefaultWorkerOptions()
	searchOpts.Concurrency = 2
	searchOpts.AutoStart = false
	searchWorker := flashq.NewWorkerSingle(searchQueue, searchProcessor, nil, &searchOpts)

	genOpts := flashq.DefaultWorkerOptions()
	genOpts.Concurrency = 1
	genOpts.AutoStart = false
	genWorker := flashq.NewWorkerSingle(generateQueue, generateProcessor, nil, &genOpts)

	embedWorker.Start(ctx)
	searchWorker.Start(ctx)
	genWorker.Start(ctx)
	time.Sleep(500 * time.Millisecond)

	// Index documents
	fmt.Println("Phase 1: Indexing documents...")
	documents := []struct {
		DocID string
		Text  string
	}{
		{"doc1", "FlashQ is a high-performance job queue built in Rust."},
		{"doc2", "It supports priorities, delays, and rate limiting."},
		{"doc3", "Workers can process jobs concurrently with configurable limits."},
		{"doc4", "The queue persists to SQLite for durability."},
		{"doc5", "It is compatible with BullMQ APIs for easy migration."},
	}

	embedJobIDs := make([]int64, 0)
	for _, doc := range documents {
		jobID, err := client.Push(embedQueue, map[string]interface{}{
			"doc_id": doc.DocID,
			"text":   doc.Text,
		}, nil)
		if err != nil {
			log.Fatalf("Failed to push embed job: %v", err)
		}
		embedJobIDs = append(embedJobIDs, jobID)
	}

	// Wait for embeddings
	for _, jobID := range embedJobIDs {
		client.Finished(jobID, 10*time.Second)
	}
	fmt.Printf("Indexed %d documents\n\n", len(documents))

	// Process a query
	fmt.Println("Phase 2: Processing query...")
	userQuery := "How does FlashQ handle job priorities?"
	fmt.Printf("Query: \"%s\"\n\n", userQuery)

	// Search for relevant documents
	searchJobID, err := client.Push(searchQueue, map[string]interface{}{
		"query": userQuery,
		"top_k": 3,
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push search job: %v", err)
	}

	searchResult, err := client.Finished(searchJobID, 10*time.Second)
	if err != nil {
		log.Fatalf("Search failed: %v", err)
	}

	fmt.Println("Retrieved context:")
	if sr, ok := searchResult.(map[string]interface{}); ok {
		if results, ok := sr["results"].([]interface{}); ok {
			for i, r := range results {
				fmt.Printf("  %d. %v\n", i+1, r)
			}
		}
	}

	// Generate response
	fmt.Println("\nPhase 3: Generating response...")
	var searchResults []interface{}
	if sr, ok := searchResult.(map[string]interface{}); ok {
		if r, ok := sr["results"].([]interface{}); ok {
			searchResults = r
		}
	}

	genJobID, err := client.Push(generateQueue, map[string]interface{}{
		"query":   userQuery,
		"context": searchResults,
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push generate job: %v", err)
	}

	genResult, err := client.Finished(genJobID, 10*time.Second)
	if err != nil {
		log.Fatalf("Generate failed: %v", err)
	}

	fmt.Println("\n=== Final Response ===")
	if gr, ok := genResult.(map[string]interface{}); ok {
		fmt.Println(gr["response"])
	}

	// Cleanup
	embedWorker.Stop(ctx)
	searchWorker.Stop(ctx)
	genWorker.Stop(ctx)

	client.Obliterate(embedQueue)
	client.Obliterate(searchQueue)
	client.Obliterate(generateQueue)

	fmt.Println("\n=== Pipeline Complete ===")
}
