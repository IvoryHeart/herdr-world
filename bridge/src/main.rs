mod agent_activity;
mod agent_pins;
mod launcher_presets;
mod notes;
mod observability;
mod observability_http;
mod observability_prometheus;
mod session;
mod store_util;
mod task_summary;
mod web_bridge;
mod workspace;

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(web_bridge::run_command(&args)?);
}
