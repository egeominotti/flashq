//! Startup banner and summary display.

/// Configuration for startup display.
pub struct StartupConfig {
    pub version: &'static str,
    pub mode: String,
    pub auth_enabled: bool,
    pub token_count: usize,
    pub runtime: &'static str,
    pub tcp_port: u16,
    pub http_port: Option<u16>,
    pub grpc_port: Option<u16>,
    pub unix_socket: Option<String>,
    pub docs_url: Option<String>,
    pub s3_backup: bool,
}

impl StartupConfig {
    pub fn new() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION"),
            mode: "In-memory".to_string(),
            auth_enabled: false,
            token_count: 0,
            runtime: crate::runtime::runtime_description(),
            tcp_port: 6789,
            http_port: None,
            grpc_port: None,
            unix_socket: None,
            docs_url: None,
            s3_backup: false,
        }
    }
}

/// ANSI color codes for terminal output.
mod colors {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const CYAN: &str = "\x1b[36m";
    pub const GREEN: &str = "\x1b[32m";
    pub const YELLOW: &str = "\x1b[33m";
    pub const BLUE: &str = "\x1b[34m";
    pub const MAGENTA: &str = "\x1b[35m";
}

/// Check if terminal supports colors.
fn supports_color() -> bool {
    // Check NO_COLOR environment variable (standard)
    if std::env::var("NO_COLOR").is_ok() {
        return false;
    }
    // Check if stdout is a terminal
    atty::is(atty::Stream::Stdout)
}

/// Print the startup banner with ASCII logo and configuration summary.
pub fn print_startup_summary(config: &StartupConfig) {
    let use_color = supports_color();

    let (bold, dim, cyan, green, yellow, blue, magenta, reset) = if use_color {
        (
            colors::BOLD,
            colors::DIM,
            colors::CYAN,
            colors::GREEN,
            colors::YELLOW,
            colors::BLUE,
            colors::MAGENTA,
            colors::RESET,
        )
    } else {
        ("", "", "", "", "", "", "", "")
    };

    let box_width = 57;
    let horizontal = "─".repeat(box_width);

    // ASCII Logo with colors
    println!();
    println!(
        "  {cyan}{bold}   __ _           _      ___  {reset}",
        cyan = cyan,
        bold = bold,
        reset = reset
    );
    println!(
        "  {cyan}{bold}  / _| | __ _ ___| |__  / _ \\ {reset}",
        cyan = cyan,
        bold = bold,
        reset = reset
    );
    println!(
        "  {cyan}{bold} | |_| |/ _` / __| '_ \\| | | |{reset}",
        cyan = cyan,
        bold = bold,
        reset = reset
    );
    println!(
        "  {cyan}{bold} |  _| | (_| \\__ \\ | | | |_| |{reset}",
        cyan = cyan,
        bold = bold,
        reset = reset
    );
    println!(
        "  {cyan}{bold} |_| |_|\\__,_|___/_| |_|\\__\\_\\{reset}",
        cyan = cyan,
        bold = bold,
        reset = reset
    );
    println!();

    // Top border
    println!(
        "  {dim}┌{h}┐{reset}",
        dim = dim,
        h = horizontal,
        reset = reset
    );

    // Title row
    let title = format!("High-Performance Job Queue v{}", config.version);
    let padding = box_width - title.len();
    let left_pad = padding / 2;
    let right_pad = padding - left_pad;
    println!(
        "  {dim}│{reset}{bold}{:>width$}{title}{:>rwidth$}{reset}{dim}│{reset}",
        "",
        "",
        dim = dim,
        bold = bold,
        reset = reset,
        title = title,
        width = left_pad,
        rwidth = right_pad
    );

    // Separator
    println!(
        "  {dim}├{h}┤{reset}",
        dim = dim,
        h = horizontal,
        reset = reset
    );

    // Configuration rows
    print_row(dim, reset, "Mode", &config.mode, green, box_width);

    let auth_status = if config.auth_enabled {
        format!("Enabled ({} tokens)", config.token_count)
    } else {
        "Disabled".to_string()
    };
    let auth_color = if config.auth_enabled { green } else { yellow };
    print_row(dim, reset, "Auth", &auth_status, auth_color, box_width);

    print_row(dim, reset, "Runtime", config.runtime, blue, box_width);

    if config.s3_backup {
        print_row(dim, reset, "Backup", "S3 enabled", green, box_width);
    }

    // Separator
    println!(
        "  {dim}├{h}┤{reset}",
        dim = dim,
        h = horizontal,
        reset = reset
    );

    // Endpoints
    print_row(
        dim,
        reset,
        "TCP",
        &format!("tcp://0.0.0.0:{}", config.tcp_port),
        magenta,
        box_width,
    );

    if let Some(port) = config.http_port {
        print_row(
            dim,
            reset,
            "HTTP",
            &format!("http://0.0.0.0:{}", port),
            magenta,
            box_width,
        );
    }

    if let Some(port) = config.grpc_port {
        print_row(
            dim,
            reset,
            "gRPC",
            &format!("grpc://0.0.0.0:{}", port),
            magenta,
            box_width,
        );
    }

    if let Some(ref socket) = config.unix_socket {
        print_row(dim, reset, "Unix", socket, magenta, box_width);
    }

    if let Some(ref docs) = config.docs_url {
        print_row(dim, reset, "Docs", docs, cyan, box_width);
    }

    // Bottom border
    println!(
        "  {dim}└{h}┘{reset}",
        dim = dim,
        h = horizontal,
        reset = reset
    );
    println!();
}

fn print_row(dim: &str, reset: &str, label: &str, value: &str, color: &str, width: usize) {
    let content = format!("  {}:  {}", label, value);
    let padding = width - content.chars().count();
    println!(
        "  {dim}│{reset} {label}:{color}  {value}{:>pad$}{reset} {dim}│{reset}",
        "",
        dim = dim,
        reset = reset,
        label = label,
        color = color,
        value = value,
        pad = padding - label.len() - 3,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_startup_config_defaults() {
        let config = StartupConfig::new();
        assert!(!config.auth_enabled);
        assert_eq!(config.tcp_port, 6789);
    }
}
