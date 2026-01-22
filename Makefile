# FlashQ Makefile
# ===============

.PHONY: build run dev server test fmt lint check clean help

# Configuration
HTTP_PORT ?= 6790
TCP_PORT ?= 6789
DATA_PATH ?= ./data/flashq.db
PIDFILE := /tmp/flashq.pid

# =============
# Quick Commands
# =============

build:
	cd engine && cargo build --release --bin flashq-server

kill:
	@lsof -ti:$(TCP_PORT) | xargs kill -9 2>/dev/null || true
	@lsof -ti:$(HTTP_PORT) | xargs kill -9 2>/dev/null || true
	@lsof -ti:6791 | xargs kill -9 2>/dev/null || true
	@pkill -9 -f flashq-server 2>/dev/null || true

run: kill build
	cd engine && HTTP=1 DATA_PATH=$(DATA_PATH) ./target/release/flashq-server

dev:
	cd engine && HTTP=1 cargo run --bin flashq-server

server:
	cd engine && HTTP=1 GRPC=1 cargo run --release --bin flashq-server

# =============
# Code Quality
# =============

fmt:
	cd engine && cargo fmt

lint:
	cd engine && cargo clippy -- -D warnings

check:
	cd engine && cargo fmt --check && cargo clippy -- -D warnings
	@echo "✓ Code quality checks passed"

test:
	cd engine && cargo test

# =============
# Server Management
# =============

start: build
	@mkdir -p ./data
	@cd engine && HTTP=1 DATA_PATH=$(DATA_PATH) \
		nohup ./target/release/flashq-server > /tmp/flashq.log 2>&1 & echo $$! > $(PIDFILE)
	@echo "Starting server..."
	@for i in $$(seq 1 15); do \
		curl -s http://localhost:$(HTTP_PORT)/health > /dev/null 2>&1 && break; \
		sleep 1; \
	done
	@curl -s http://localhost:$(HTTP_PORT)/health > /dev/null 2>&1 && \
		echo "✓ Server ready at http://localhost:$(HTTP_PORT)" || \
		(echo "✗ Server failed to start" && cat /tmp/flashq.log && exit 1)

stop:
	@if [ -f $(PIDFILE) ]; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
		rm -f $(PIDFILE); \
		echo "✓ Server stopped"; \
	else \
		pkill -f "flashq-server" 2>/dev/null && echo "✓ Server stopped" || echo "Server not running"; \
	fi

restart: stop start

logs:
	@tail -f /tmp/flashq.log

# =============
# Docker
# =============

docker-build:
	docker build -t flashq .

docker-run:
	docker run -p $(TCP_PORT):6789 -p $(HTTP_PORT):6790 flashq

# =============
# Testing
# =============

sdk-test:
	cd sdk/typescript && bun run examples/comprehensive-test.ts

stress:
	cd sdk/typescript && bun run examples/stress-test.ts

bench:
	cd engine && cargo bench --bench queue_benchmark

# =============
# Utilities
# =============

dashboard:
ifeq ($(shell uname),Darwin)
	open http://localhost:$(HTTP_PORT)
else
	@echo "Open http://localhost:$(HTTP_PORT)"
endif

clean:
	cd engine && cargo clean
	rm -f $(PIDFILE) /tmp/flashq.log

# =============
# Help
# =============

help:
	@echo "FlashQ Commands"
	@echo ""
	@echo "Quick Start:"
	@echo "  make build       Build release binary"
	@echo "  make run         Build and run server (SQLite)"
	@echo "  make dev         Run in dev mode (slower)"
	@echo "  make server      Run with HTTP + gRPC"
	@echo ""
	@echo "Server:"
	@echo "  make start       Start server in background"
	@echo "  make stop        Stop server"
	@echo "  make restart     Restart server"
	@echo "  make logs        View server logs"
	@echo ""
	@echo "Code Quality:"
	@echo "  make fmt         Format code"
	@echo "  make lint        Run clippy"
	@echo "  make check       Run fmt + clippy"
	@echo "  make test        Run unit tests"
	@echo ""
	@echo "Other:"
	@echo "  make dashboard   Open dashboard"
	@echo "  make bench       Run benchmarks"
	@echo "  make clean       Clean build"

.DEFAULT_GOAL := help
