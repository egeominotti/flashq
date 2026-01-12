FROM rust:1.85-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
COPY server/ ./
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/flashq-server /flashq-server
EXPOSE 6789
ENV RUST_LOG=info
CMD ["/flashq-server"]
