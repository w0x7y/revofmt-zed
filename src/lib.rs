mod integrity;
mod options;
mod server_checksums;

use std::{fs, path::Path};
use zed_extension_api::{self as zed, settings::LspSettings};

const SERVER_ID: &str = "revofmt-lsp";
const SERVER_DIRECTORY: &str = "revofmt-lsp-0.2.0";
const SERVER_URL: &str =
    "https://github.com/w0x7y/revofmt-zed/releases/download/v0.2.0/revofmt-lsp-0.2.0.tar.gz";

struct RevoFormatterExtension;

fn server_entrypoint(directory: &Path) -> zed::Result<String> {
    // Integrity admission already rejects symlinks. Rust 1.90 WASI does not
    // support filesystem canonicalization; Zed initializes the working directory.
    let entrypoint = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join(directory)
        .join("server/main.cjs");
    Ok(entrypoint
        .to_str()
        .ok_or("Downloaded server path is not UTF-8")?
        .to_owned())
}

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
        let directory = Path::new(SERVER_DIRECTORY);
        if integrity::verify_server(directory, server_checksums::SERVER_FILES).is_err() {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            match fs::symlink_metadata(directory) {
                Ok(metadata) if metadata.is_dir() => {
                    fs::remove_dir_all(directory).map_err(|error| error.to_string())?
                }
                Ok(_) => fs::remove_file(directory).map_err(|error| error.to_string())?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            zed::download_file(
                SERVER_URL,
                SERVER_DIRECTORY,
                zed::DownloadedFileType::GzipTar,
            )?;
            integrity::verify_server(directory, server_checksums::SERVER_FILES)?;
        }
        let entrypoint = server_entrypoint(directory)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_absolute_entrypoint_without_filesystem_canonicalization() {
        let directory = Path::new("entrypoint resolution fixture with spaces");
        assert!(!directory.exists());
        let expected = format!(
            "{}/entrypoint resolution fixture with spaces/server/main.cjs",
            std::env::current_dir().unwrap().display()
        );
        assert_eq!(server_entrypoint(directory).unwrap(), expected);
    }
}
