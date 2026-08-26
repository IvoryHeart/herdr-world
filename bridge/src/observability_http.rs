//! World-owned HTTP and WebSocket transport for the observability projection.
//!
//! Keeping this router beside the observability contract and provider leaves
//! the shared Herdr Web bridge entrypoint with only a small mounting seam.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tracing::{info, warn};

use crate::observability::{
    ObservabilityConfiguration, ObservabilityDescriptor, ObservabilityExtensionResponse,
    ObservabilityProvider, ObservabilityState, ObservabilityTransportMessage,
    UnavailableObservabilityProvider,
};
use crate::observability_prometheus::{PrometheusConfig, PrometheusObservabilityProvider};
use crate::web_bridge::{ensure_allowed_request, preflight_response, BridgeError, RequestPolicy};

#[derive(Clone)]
struct ObservabilityHttpState {
    request_policy: RequestPolicy,
    observability: ObservabilityState,
}

#[derive(Debug, Deserialize)]
struct ObservabilityConfigurationRequest {
    prometheus_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ObservabilityEventsQuery {
    after_sequence: Option<u64>,
}

pub(crate) fn state_from_environment() -> ObservabilityState {
    match PrometheusConfig::from_env() {
        Ok(Some(config)) => {
            let endpoint = config.endpoint_string();
            info!(
                provider = "prometheus.otel",
                window_seconds = config.window_seconds,
                refresh_seconds = config.refresh_seconds,
                "Prometheus observability provider enabled"
            );
            ObservabilityState::with_provider_and_configuration(
                PrometheusObservabilityProvider::start(config),
                ObservabilityConfiguration {
                    provider_id: "prometheus.otel".to_string(),
                    configured: true,
                    endpoint: Some(endpoint),
                },
            )
        }
        Ok(None) => ObservabilityState::unavailable(),
        Err(error) => {
            warn!(error = %error, "Prometheus observability provider configuration rejected");
            ObservabilityState::unavailable()
        }
    }
}

pub(crate) fn routes<S>(
    request_policy: RequestPolicy,
    observability: ObservabilityState,
) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/api/extensions/observability",
            get(descriptor_handler).options(preflight_handler),
        )
        .route(
            "/api/extensions/observability/snapshot",
            get(snapshot_handler).options(preflight_handler),
        )
        .route(
            "/api/extensions/observability/config",
            get(configuration_handler)
                .put(update_configuration_handler)
                .options(preflight_handler),
        )
        .route("/ws/extensions/observability", get(websocket_handler))
        .with_state(ObservabilityHttpState {
            request_policy,
            observability,
        })
}

async fn preflight_handler(
    State(state): State<ObservabilityHttpState>,
    headers: HeaderMap,
) -> Result<Response, BridgeError> {
    preflight_response(&headers, &state.request_policy)
}

async fn descriptor_handler(
    State(state): State<ObservabilityHttpState>,
    headers: HeaderMap,
) -> Result<Json<ObservabilityDescriptor>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let descriptor = state
        .observability
        .descriptor()
        .map_err(|error| BridgeError::Protocol(error.to_string()))?;
    Ok(Json(descriptor))
}

async fn snapshot_handler(
    State(state): State<ObservabilityHttpState>,
    headers: HeaderMap,
) -> Result<Json<ObservabilityExtensionResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let snapshot = state
        .observability
        .snapshot()
        .map_err(|error| BridgeError::Protocol(error.to_string()))?;
    Ok(Json(snapshot))
}

async fn configuration_handler(
    State(state): State<ObservabilityHttpState>,
    headers: HeaderMap,
) -> Result<Json<ObservabilityConfiguration>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(state.observability.configuration()))
}

async fn update_configuration_handler(
    State(state): State<ObservabilityHttpState>,
    headers: HeaderMap,
    Json(body): Json<ObservabilityConfigurationRequest>,
) -> Result<Json<ObservabilityConfiguration>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let raw_endpoint = body
        .prometheus_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let (provider, configuration): (Arc<dyn ObservabilityProvider>, ObservabilityConfiguration) =
        match raw_endpoint {
            Some(raw_endpoint) => {
                let config = PrometheusConfig::from_settings_endpoint(raw_endpoint)
                    .map_err(BridgeError::BadRequest)?;
                let endpoint = config.endpoint_string();
                (
                    PrometheusObservabilityProvider::start_ready(config).await,
                    ObservabilityConfiguration {
                        provider_id: "prometheus.otel".to_string(),
                        configured: true,
                        endpoint: Some(endpoint),
                    },
                )
            }
            None => (
                Arc::new(UnavailableObservabilityProvider),
                ObservabilityConfiguration {
                    provider_id: "none".to_string(),
                    configured: false,
                    endpoint: None,
                },
            ),
        };
    state
        .observability
        .replace_provider(provider, configuration.clone());
    Ok(Json(configuration))
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<ObservabilityHttpState>,
    Query(query): Query<ObservabilityEventsQuery>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = ensure_allowed_request(&headers, &state.request_policy) {
        return error.into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state.observability, query.after_sequence))
        .into_response()
}

async fn handle_socket(
    socket: WebSocket,
    observability: ObservabilityState,
    after_sequence: Option<u64>,
) {
    let mut observability_rx = observability.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    if after_sequence.is_some()
        && send_message(
            &mut ws_sender,
            &ObservabilityTransportMessage::ResyncRequired {
                reason: "event replay is not retained by this provider".to_string(),
                after_sequence,
            },
        )
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            event = observability_rx.recv() => {
                match event {
                    Ok(event) => {
                        if send_message(&mut ws_sender, &event).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = send_message(
                            &mut ws_sender,
                            &ObservabilityTransportMessage::ResyncRequired {
                                reason: "observability receiver lagged".to_string(),
                                after_sequence: None,
                            },
                        ).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

async fn send_message(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: &ObservabilityTransportMessage,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(message).unwrap_or_else(|_| {
        r#"{"type":"resync_required","reason":"observability serialization failed","after_sequence":null}"#.to_string()
    });
    ws_sender.send(Message::Text(text.into())).await
}
