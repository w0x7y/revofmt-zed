mod integrity;
mod options;
mod server_checksums;

use std::path::Path;
use zed_extension_api::{self as zed, settings::LspSettings};

const SERVER_ID: &str = "revofmt-lsp";
const SERVER_DIRECTORY: &str = "revofmt-lsp-0.3.0";
const SERVER_URL: &str =
    "https://github.com/w0x7y/revofmt-zed/releases/download/v0.3.0/revofmt-lsp-0.3.0.tar.gz";

struct RevoFormatterExtension;

impl zed::Extension for RevoFormatterExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let settings = LspSettings::for_worktree(SERVER_ID, worktree)?;
        let formatter = options::resolve_formatter(
            settings.initialization_options.as_ref(),
            worktree.which("revofmt"),
        )?;
        let node = zed::node_binary_path()?;
        let entrypoint = integrity::server_entrypoint(
            Path::new(SERVER_DIRECTORY),
            server_checksums::SERVER_FILES,
            || {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Downloading,
                );
                zed::download_file(
                    SERVER_URL,
                    SERVER_DIRECTORY,
                    zed::DownloadedFileType::GzipTar,
                )
            },
        )?;
        Ok(zed::Command {
            command: node,
            args: vec![entrypoint, "--formatter".into(), formatter],
            env: worktree.shell_env(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        let options = LspSettings::for_worktree(SERVER_ID, worktree)?.initialization_options;
        options::validate_options(options.as_ref())?;
        Ok(options)
    }
}

zed::register_extension!(RevoFormatterExtension);
