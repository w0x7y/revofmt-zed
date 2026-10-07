use std::path::Path;
use zed_extension_api::serde_json::Value;

pub fn validate_options(options: Option<&Value>) -> Result<(), String> {
    let Some(options) = options.filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let object = options
        .as_object()
        .ok_or("revofmt-lsp initialization_options must be an object")?;
    if let Some(executable) = object.get("executable") {
        validate_path(
            executable
                .as_str()
                .ok_or("executable must be an absolute path string")?,
        )?;
    }
    for (name, minimum, maximum) in [
        ("indentWidth", 1, 8),
        ("lineWidth", 20, 240),
        ("timeoutMs", 1, 60000),
    ] {
        if let Some(value) = object.get(name) {
            if !value.as_f64().is_some_and(|number| {
                number.fract() == 0.0 && (f64::from(minimum)..=f64::from(maximum)).contains(&number)
            }) {
                return Err(format!(
                    "{name} must be an integer from {minimum} to {maximum}"
                ));
            }
        }
    }
    Ok(())
}

fn validate_path(path: &str) -> Result<(), String> {
    if !Path::new(path).is_absolute() || path.contains('\0') {
        return Err(
            "executable must be a literal absolute path; shell and ~ expansion are unsupported"
                .into(),
        );
    }
    Ok(())
}

pub fn resolve_formatter(
    options: Option<&Value>,
    discovered: Option<String>,
) -> Result<String, String> {
    validate_options(options)?;
    let formatter = options.and_then(|value| value.get("executable"))
        .and_then(Value::as_str).map(str::to_owned).or(discovered)
        .ok_or("Install revofmt on your worktree PATH or set lsp.revofmt-lsp.initialization_options.executable to its absolute path")?;
    validate_path(&formatter)?;
    Ok(formatter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zed_extension_api::serde_json::json;

    #[test]
    fn rejects_invalid_option_types_and_ranges() {
        for options in [
            json!([]),
            json!("options"),
            json!({"executable": null}),
            json!({"executable": "revofmt"}),
            json!({"executable": "~/bin/revofmt"}),
            json!({"executable": "/bin/revofmt\u{0}"}),
            json!({"indentWidth": 0}),
            json!({"indentWidth": 9}),
            json!({"indentWidth": 2.5}),
            json!({"indentWidth": "2"}),
            json!({"lineWidth": 19}),
            json!({"lineWidth": 241}),
            json!({"lineWidth": true}),
            json!({"timeoutMs": 0}),
            json!({"timeoutMs": 60001}),
            json!({"timeoutMs": null}),
        ] {
            assert!(
                validate_options(Some(&options)).is_err(),
                "accepted {options}"
            );
        }
    }

    #[test]
    fn accepts_absent_options_and_inclusive_boundaries() {
        assert!(validate_options(None).is_ok());
        for options in [
            json!(null),
            json!({}),
            json!({"indentWidth": 1, "lineWidth": 20, "timeoutMs": 1}),
            json!({"indentWidth": 8, "lineWidth": 240, "timeoutMs": 60000}),
            json!({"indentWidth": 2.0, "lineWidth": 80.0, "timeoutMs": 5000.0}),
            json!({"executable": "/opt/Revo Formatter/revofmt;literal"}),
        ] {
            assert!(
                validate_options(Some(&options)).is_ok(),
                "rejected {options}"
            );
        }
    }

    #[test]
    fn explicit_formatter_overrides_worktree_lookup_as_literal_path() {
        let options = json!({"executable": "/opt/Revo Formatter/revofmt;literal"});
        assert_eq!(
            resolve_formatter(Some(&options), Some("/usr/bin/revofmt".into())).unwrap(),
            "/opt/Revo Formatter/revofmt;literal"
        );
    }

    #[test]
    fn requires_absolute_discovered_formatter_and_rejects_missing_formatter() {
        assert_eq!(
            resolve_formatter(None, Some("/usr/bin/revofmt".into())).unwrap(),
            "/usr/bin/revofmt"
        );
        assert!(resolve_formatter(None, Some("relative/revofmt".into())).is_err());
        assert!(resolve_formatter(None, None).is_err());
    }
}
