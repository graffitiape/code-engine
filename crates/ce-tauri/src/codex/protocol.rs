use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum InboundMessage {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<Value>,
    },
    ServerRequest {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

pub fn classify_message(message: Value) -> Result<InboundMessage, String> {
    let object = message
        .as_object()
        .ok_or_else(|| "app-server message must be a JSON object".to_string())?;

    if let Some(method) = object.get("method") {
        let method = method
            .as_str()
            .ok_or_else(|| "app-server method must be a string".to_string())?
            .to_string();
        let params = object.get("params").cloned().unwrap_or(Value::Null);

        if let Some(id) = object.get("id") {
            validate_request_id(id)?;
            return Ok(InboundMessage::ServerRequest {
                id: id.clone(),
                method,
                params,
            });
        }

        return Ok(InboundMessage::Notification { method, params });
    }

    let id = object
        .get("id")
        .ok_or_else(|| "app-server response is missing an id".to_string())?;
    validate_request_id(id)?;

    let result = object.get("result").cloned();
    let error = object.get("error").cloned();
    if result.is_some() == error.is_some() {
        return Err("app-server response must contain exactly one of result or error".to_string());
    }

    Ok(InboundMessage::Response {
        id: id.clone(),
        result,
        error,
    })
}

pub fn request_id_key(id: &Value) -> Result<String, String> {
    match id {
        Value::String(value) => Ok(format!("s:{value}")),
        Value::Number(value) => Ok(format!("n:{value}")),
        _ => Err("request id must be a string or number".to_string()),
    }
}

pub fn should_surface_server_request(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/tool/requestUserInput"
            | "item/permissions/requestApproval"
            | "mcpServer/elicitation/request"
            | "applyPatchApproval"
            | "execCommandApproval"
    )
}

pub fn validate_server_response(method: &str, response: &Value) -> Result<(), String> {
    match method {
        "item/commandExecution/requestApproval" => validate_command_approval(response),
        "item/fileChange/requestApproval" => validate_file_change_approval(response),
        "item/tool/requestUserInput" => validate_user_input(response),
        "item/permissions/requestApproval" => validate_permissions_response(response),
        "mcpServer/elicitation/request" => validate_mcp_elicitation(response),
        "applyPatchApproval" | "execCommandApproval" => validate_legacy_approval(response),
        // These requests are only emitted after an explicit experimental or host-owned
        // capability is enabled. Keep their payloads forward-compatible while still
        // requiring a JSON object and an outstanding request id in the process manager.
        _ if response.is_object() => Ok(()),
        _ => Err(format!(
            "response for server request {method} must be a JSON object"
        )),
    }
}

fn validate_request_id(id: &Value) -> Result<(), String> {
    request_id_key(id).map(|_| ())
}

fn response_object(response: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    response
        .as_object()
        .ok_or_else(|| "server request response must be a JSON object".to_string())
}

fn validate_command_approval(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    let decision = object
        .get("decision")
        .ok_or_else(|| "command approval response is missing decision".to_string())?;

    match decision {
        Value::String(value)
            if matches!(
                value.as_str(),
                "accept" | "acceptForSession" | "decline" | "cancel"
            ) =>
        {
            Ok(())
        }
        Value::Object(value)
            if value
                .get("acceptWithExecpolicyAmendment")
                .is_some_and(Value::is_object)
                || value
                    .get("applyNetworkPolicyAmendment")
                    .is_some_and(Value::is_object) =>
        {
            Ok(())
        }
        _ => Err("unsupported command approval decision".to_string()),
    }
}

fn validate_file_change_approval(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    match object.get("decision").and_then(Value::as_str) {
        Some("accept" | "acceptForSession" | "decline" | "cancel") => Ok(()),
        _ => Err("unsupported file change approval decision".to_string()),
    }
}

fn validate_user_input(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    let answers = object
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(|| "user input response must contain an answers object".to_string())?;

    for answer in answers.values() {
        let values = answer
            .as_object()
            .and_then(|answer| answer.get("answers"))
            .and_then(Value::as_array)
            .ok_or_else(|| "each user input answer must contain an answers array".to_string())?;
        if !values.iter().all(Value::is_string) {
            return Err("user input answers must be strings".to_string());
        }
    }

    Ok(())
}

fn validate_permissions_response(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    if !object.get("permissions").is_some_and(Value::is_object) {
        return Err("permission response must contain a permissions object".to_string());
    }
    match object.get("scope").and_then(Value::as_str) {
        Some("turn" | "session") => {}
        _ => return Err("permission response scope must be turn or session".to_string()),
    }
    if object
        .get("strictAutoReview")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("strictAutoReview must be a boolean".to_string());
    }
    Ok(())
}

fn validate_mcp_elicitation(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    match object.get("action").and_then(Value::as_str) {
        Some("accept") if object.contains_key("content") => Ok(()),
        Some("decline" | "cancel") if object.get("content").is_none_or(Value::is_null) => Ok(()),
        Some("accept") => Err("accepted MCP elicitation must include content".to_string()),
        _ => Err("MCP elicitation action must be accept, decline, or cancel".to_string()),
    }
}

fn validate_legacy_approval(response: &Value) -> Result<(), String> {
    let object = response_object(response)?;
    let decision = object
        .get("decision")
        .ok_or_else(|| "legacy approval response is missing decision".to_string())?;
    match decision {
        Value::String(value)
            if matches!(
                value.as_str(),
                "approved" | "approved_for_session" | "denied" | "timed_out" | "abort"
            ) =>
        {
            Ok(())
        }
        Value::Object(value)
            if value
                .get("approved_execpolicy_amendment")
                .is_some_and(Value::is_object)
                || value
                    .get("network_policy_amendment")
                    .is_some_and(Value::is_object) =>
        {
            Ok(())
        }
        _ => Err("unsupported legacy approval decision".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        classify_message, should_surface_server_request, validate_server_response, InboundMessage,
    };

    #[test]
    fn classifies_response_notification_and_server_request() {
        assert_eq!(
            classify_message(json!({ "id": 7, "result": { "ok": true } })).unwrap(),
            InboundMessage::Response {
                id: json!(7),
                result: Some(json!({ "ok": true })),
                error: None,
            }
        );
        assert_eq!(
            classify_message(json!({ "method": "turn/completed", "params": { "turn": {} } }))
                .unwrap(),
            InboundMessage::Notification {
                method: "turn/completed".to_string(),
                params: json!({ "turn": {} }),
            }
        );
        assert_eq!(
            classify_message(json!({
                "id": "approval-1",
                "method": "item/fileChange/requestApproval",
                "params": { "itemId": "item-1" }
            }))
            .unwrap(),
            InboundMessage::ServerRequest {
                id: json!("approval-1"),
                method: "item/fileChange/requestApproval".to_string(),
                params: json!({ "itemId": "item-1" }),
            }
        );
    }

    #[test]
    fn rejects_ambiguous_or_invalid_messages() {
        assert!(classify_message(json!({ "id": 1 })).is_err());
        assert!(classify_message(json!({ "id": {}, "result": null })).is_err());
        assert!(classify_message(json!({
            "id": 1,
            "result": {},
            "error": { "message": "no" }
        }))
        .is_err());
    }

    #[test]
    fn validates_supported_approval_responses() {
        assert!(validate_server_response(
            "item/commandExecution/requestApproval",
            &json!({ "decision": "acceptForSession" })
        )
        .is_ok());
        assert!(validate_server_response(
            "item/fileChange/requestApproval",
            &json!({ "decision": "decline" })
        )
        .is_ok());
        assert!(validate_server_response(
            "item/fileChange/requestApproval",
            &json!({ "decision": "approved" })
        )
        .is_err());
        assert!(validate_server_response(
            "item/tool/requestUserInput",
            &json!({ "answers": { "choice": { "answers": ["yes"] } } })
        )
        .is_ok());
        assert!(validate_server_response(
            "item/permissions/requestApproval",
            &json!({ "permissions": { "network": {} }, "scope": "turn" })
        )
        .is_ok());
        assert!(validate_server_response(
            "mcpServer/elicitation/request",
            &json!({ "action": "decline", "content": null })
        )
        .is_ok());
        assert!(validate_server_response(
            "mcpServer/elicitation/request",
            &json!({ "action": "accept" })
        )
        .is_err());
    }

    #[test]
    fn only_surfaces_server_requests_the_ui_can_answer() {
        assert!(should_surface_server_request(
            "item/commandExecution/requestApproval"
        ));
        assert!(should_surface_server_request("item/tool/requestUserInput"));
        assert!(should_surface_server_request(
            "mcpServer/elicitation/request"
        ));
        assert!(!should_surface_server_request("item/tool/call"));
        assert!(!should_surface_server_request("currentTime/read"));
        assert!(!should_surface_server_request(
            "account/chatgptAuthTokens/refresh"
        ));
    }
}
