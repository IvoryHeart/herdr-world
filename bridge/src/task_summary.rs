use std::collections::HashMap;
use std::env;
use std::io;
use std::sync::OnceLock;

use herdr_compat::api::client::ApiClient;
use herdr_compat::api::schema::{
    Method, PaneInfo, PaneReportMetadataParams, PaneTarget, Request, ResponseResult,
};
use regex::Regex;
use serde::Serialize;

pub(crate) const TASK_SUMMARY_TOKEN: &str = "task_summary";
const TASK_SUMMARY_SOURCE: &str = "herdr-world:task-summary";
const DEFAULT_TASK_SUMMARY_TTL_MS: u64 = 15 * 60 * 1_000;
const MAX_TASK_SUMMARY_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_TASK_SUMMARY_CHARS: usize = 160;

#[derive(Debug, PartialEq, Eq)]
struct TaskSummaryCommand {
    pane_id: String,
    session: Option<String>,
    ttl_ms: Option<u64>,
    summary: Option<String>,
}

#[derive(Debug, Serialize)]
struct TaskSummaryResult<'a> {
    pane_id: &'a str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    ttl_ms: Option<u64>,
}

pub(crate) fn is_task_summary_command(args: &[String]) -> bool {
    args.first().is_some_and(|arg| arg == "task-summary")
}

pub(crate) fn run_task_summary_command(args: &[String]) -> io::Result<i32> {
    let command = match parse_task_summary_command(&args[1..]) {
        Ok(Some(command)) => command,
        Ok(None) => return Ok(0),
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{}", task_summary_help());
            return Ok(2);
        }
    };

    if let Some(session) = command.session.as_deref() {
        if let Err(message) = crate::session::configure_explicit_session(session) {
            eprintln!("{message}");
            return Ok(2);
        }
    }

    let api = ApiClient::for_socket_path(crate::session::active_api_socket_path());
    match report_task_summary(&api, &command) {
        Ok(()) => {
            let result = TaskSummaryResult {
                pane_id: &command.pane_id,
                status: if command.summary.is_some() {
                    "reported"
                } else {
                    "cleared"
                },
                ttl_ms: command.ttl_ms,
            };
            println!(
                "{}",
                serde_json::to_string(&result).expect("task summary result is serializable")
            );
            Ok(0)
        }
        Err(message) => {
            eprintln!("could not report task summary: {message}");
            Ok(1)
        }
    }
}

pub(crate) fn task_summary_from_pane(pane: &PaneInfo) -> Option<String> {
    pane.tokens
        .get(TASK_SUMMARY_TOKEN)
        .and_then(|summary| normalize_task_summary(summary).ok())
}

fn parse_task_summary_command(args: &[String]) -> Result<Option<TaskSummaryCommand>, String> {
    let mut pane_id = None;
    let mut session = None;
    let mut ttl_ms = None;
    let mut clear = false;
    let mut summary_parts = Vec::new();
    let mut positional_only = false;
    let mut index = 0;

    while index < args.len() {
        let arg = &args[index];
        if positional_only {
            summary_parts.push(arg.clone());
            index += 1;
            continue;
        }
        match arg.as_str() {
            "help" if index == 0 && args.len() == 1 => {
                println!("{}", task_summary_help());
                return Ok(None);
            }
            "--help" | "-h" => {
                println!("{}", task_summary_help());
                return Ok(None);
            }
            "--" => {
                positional_only = true;
                index += 1;
            }
            "--clear" => {
                clear = true;
                index += 1;
            }
            "--pane" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --pane".to_string());
                };
                pane_id = Some(nonempty_option(value, "pane ID")?);
                index += 2;
            }
            "--session" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --session".to_string());
                };
                crate::session::validate_session_name(value)?;
                session = Some(value.clone());
                index += 2;
            }
            "--ttl-ms" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --ttl-ms".to_string());
                };
                let parsed = value.parse::<u64>().map_err(|_| {
                    format!("--ttl-ms must be between 1 and {MAX_TASK_SUMMARY_TTL_MS}")
                })?;
                if !(1..=MAX_TASK_SUMMARY_TTL_MS).contains(&parsed) {
                    return Err(format!(
                        "--ttl-ms must be between 1 and {MAX_TASK_SUMMARY_TTL_MS}"
                    ));
                }
                ttl_ms = Some(parsed);
                index += 2;
            }
            value if value.starts_with('-') => {
                return Err(format!("unknown task-summary option: {value}"));
            }
            value => {
                summary_parts.push(value.to_string());
                index += 1;
            }
        }
    }

    let pane_id = pane_id
        .or_else(|| {
            env::var("HERDR_PANE_ID")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| "task-summary requires --pane or HERDR_PANE_ID".to_string())?;
    if clear && !summary_parts.is_empty() {
        return Err("--clear cannot be combined with summary text".to_string());
    }
    if clear && ttl_ms.is_some() {
        return Err("--clear cannot be combined with --ttl-ms".to_string());
    }
    let summary = if clear {
        None
    } else {
        let raw = summary_parts.join(" ");
        Some(normalize_task_summary(&raw)?)
    };

    Ok(Some(TaskSummaryCommand {
        pane_id,
        session,
        ttl_ms: summary
            .as_ref()
            .map(|_| ttl_ms.unwrap_or(DEFAULT_TASK_SUMMARY_TTL_MS)),
        summary,
    }))
}

fn report_task_summary(api: &ApiClient, command: &TaskSummaryCommand) -> Result<(), String> {
    let (agent, applies_to_source) = if command.summary.is_some() {
        let pane = pane_info(api, &command.pane_id)?;
        let session = pane.agent_session.ok_or_else(|| {
            "the target pane has no active agent session; summaries must be bound to a live harness"
                .to_string()
        })?;
        (Some(session.agent), Some(session.source))
    } else {
        (None, None)
    };
    let tokens = HashMap::from([(TASK_SUMMARY_TOKEN.to_string(), command.summary.clone())]);
    let response = api
        .request(Request {
            id: "herdr-world:task-summary".to_string(),
            method: Method::PaneReportMetadata(PaneReportMetadataParams {
                pane_id: command.pane_id.clone(),
                source: TASK_SUMMARY_SOURCE.to_string(),
                agent,
                applies_to_source,
                title: None,
                display_agent: None,
                state_labels: HashMap::new(),
                tokens,
                clear_title: false,
                clear_display_agent: false,
                clear_state_labels: false,
                seq: None,
                ttl_ms: command.ttl_ms,
            }),
        })
        .map_err(|error| error.to_string())?;
    if matches!(response.result, ResponseResult::Ok {}) {
        Ok(())
    } else {
        Err(format!("unexpected response: {:?}", response.result))
    }
}

fn pane_info(api: &ApiClient, pane_id: &str) -> Result<PaneInfo, String> {
    let response = api
        .request(Request {
            id: "herdr-world:task-summary-pane".to_string(),
            method: Method::PaneGet(PaneTarget {
                pane_id: pane_id.to_string(),
            }),
        })
        .map_err(|error| error.to_string())?;
    match response.result {
        ResponseResult::PaneInfo { pane } => Ok(pane),
        other => Err(format!("unexpected pane response: {other:?}")),
    }
}

fn normalize_task_summary(value: &str) -> Result<String, String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("task summary must not be empty".to_string());
    }
    let redacted = redact_task_summary(&normalized);
    let points = redacted.chars().collect::<Vec<_>>();
    if points.len() <= MAX_TASK_SUMMARY_CHARS {
        return Ok(redacted);
    }
    let mut bounded = points[..MAX_TASK_SUMMARY_CHARS - 1]
        .iter()
        .collect::<String>()
        .trim_end()
        .to_string();
    bounded.push('…');
    Ok(bounded)
}

fn redact_task_summary(value: &str) -> String {
    static REDACTIONS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = REDACTIONS.get_or_init(|| {
        [
            r"(?i)\b(?:bearer)\s+[A-Za-z0-9._~+/=-]{8,}",
            r"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+",
            r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{12,})\b",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("task-summary redaction regex is valid"))
        .collect()
    });
    patterns.iter().fold(value.to_string(), |summary, pattern| {
        pattern.replace_all(&summary, "[redacted]").into_owned()
    })
}

fn nonempty_option(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} must not be empty"))
    } else {
        Ok(value.to_string())
    }
}

fn task_summary_help() -> &'static str {
    "Usage: herdr-world task-summary [TEXT] [--ttl-ms N] [--pane ID] [--session NAME]\n\
       herdr-world task-summary --clear [--pane ID] [--session NAME]\n\
\n\
Reports a short, pane-qualified task summary for the active Herdr agent session.\n\
The default pane is HERDR_PANE_ID and the default TTL is 900000 ms (15 minutes).\n\
Whitespace is normalized, obvious credential values are redacted, and output is bounded to 160 characters."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bounds_and_redacts_reported_text() {
        assert_eq!(
            normalize_task_summary("  Running\n  release   tests  ").unwrap(),
            "Running release tests"
        );
        assert_eq!(
            normalize_task_summary("Uploading with api_key=super-secret-value").unwrap(),
            "Uploading with [redacted]"
        );
        assert_eq!(
            normalize_task_summary("Using Bearer abcdefghijklmnop to inspect CI").unwrap(),
            "Using [redacted] to inspect CI"
        );
        let bounded = normalize_task_summary(&"界".repeat(200)).unwrap();
        assert_eq!(bounded.chars().count(), MAX_TASK_SUMMARY_CHARS);
        assert!(bounded.ends_with('…'));
        assert!(normalize_task_summary(" \n\t ").is_err());
    }

    #[test]
    fn parses_bound_report_and_clear_commands() {
        let report = parse_task_summary_command(&[
            "Implementing".into(),
            "semantic targets".into(),
            "--pane".into(),
            "w1:p1".into(),
            "--ttl-ms".into(),
            "120000".into(),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(
            report,
            TaskSummaryCommand {
                pane_id: "w1:p1".into(),
                session: None,
                ttl_ms: Some(120000),
                summary: Some("Implementing semantic targets".into()),
            }
        );

        let clear =
            parse_task_summary_command(&["--clear".into(), "--pane".into(), "w1:p1".into()])
                .unwrap()
                .unwrap();
        assert_eq!(clear.summary, None);
        assert_eq!(clear.ttl_ms, None);
    }

    #[test]
    fn rejects_ambiguous_or_unbounded_commands() {
        assert!(parse_task_summary_command(&[
            "text".into(),
            "--clear".into(),
            "--pane".into(),
            "w1:p1".into(),
        ])
        .is_err());
        assert!(parse_task_summary_command(&[
            "text".into(),
            "--pane".into(),
            "w1:p1".into(),
            "--ttl-ms".into(),
            "86400001".into(),
        ])
        .is_err());
        assert_eq!(
            parse_task_summary_command(&[
                "Need".into(),
                "help".into(),
                "--pane".into(),
                "w1:p1".into(),
            ])
            .unwrap()
            .unwrap()
            .summary
            .as_deref(),
            Some("Need help")
        );
    }

    #[test]
    fn maps_only_valid_task_summary_tokens() {
        let mut pane = test_pane();
        assert_eq!(task_summary_from_pane(&pane), None);
        pane.tokens
            .insert(TASK_SUMMARY_TOKEN.into(), "  Reviewing   CI  ".into());
        assert_eq!(
            task_summary_from_pane(&pane).as_deref(),
            Some("Reviewing CI")
        );
        pane.tokens
            .insert(TASK_SUMMARY_TOKEN.into(), "secret=do-not-forward".into());
        assert_eq!(task_summary_from_pane(&pane).as_deref(), Some("[redacted]"));
    }

    fn test_pane() -> PaneInfo {
        PaneInfo {
            pane_id: "w1:p1".into(),
            terminal_id: "terminal-1".into(),
            workspace_id: "w1".into(),
            tab_id: "w1:t1".into(),
            focused: false,
            cwd: None,
            foreground_cwd: None,
            label: None,
            agent: None,
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: herdr_compat::api::schema::AgentStatus::Unknown,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            scroll: None,
            revision: 1,
        }
    }
}
