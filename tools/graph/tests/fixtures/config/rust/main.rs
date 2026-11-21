fn level() -> String {
    std::env::var("RUST_LOG_LEVEL").unwrap_or("canary-cfg-literal-9".into())
}
