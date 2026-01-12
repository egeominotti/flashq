FROM rust:1.75-slim-bookworm AS builder
WORKDIR /app
COPY server/ ./
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/flashq-server /flashq-server
EXPOSE 6789
ENV RUST_LOG=info
CMD ["/flashq-server"]