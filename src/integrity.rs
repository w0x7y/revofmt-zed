use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

pub fn verify_server(root: &Path, manifest: &[(&str, &str)]) -> Result<(), String> {
    if manifest.is_empty() {
        return Err("No runtime checksums are embedded in this extension".into());
    }
    let mut files = BTreeSet::new();
    let mut directories = BTreeSet::from([PathBuf::new()]);
    for &(relative, digest) in manifest {
        let path = Path::new(relative);
        if !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
            || !path.starts_with("server")
            || path.extension().is_none_or(|extension| extension != "cjs")
            || digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !files.insert(path.to_path_buf())
        {
            return Err(format!("Invalid runtime checksum entry: {relative}"));
        }
        for parent in path.ancestors().skip(1) {
            directories.insert(parent.to_path_buf());
        }
    }
    if !files.contains(Path::new("server/main.cjs")) {
        return Err("Runtime manifest must include server/main.cjs".into());
    }
    files.insert(PathBuf::from("LICENSE"));
    let mut found = BTreeSet::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let directory = root.join(&relative);
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("{}: {error}", directory.display()))?;
        if !metadata.is_dir() {
            return Err(format!(
                "Runtime directory is not a real directory: {}",
                directory.display()
            ));
        }
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = relative.join(entry.file_name());
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() && directories.contains(&path) {
                pending.push(path);
            } else if kind.is_file() && files.contains(&path) {
                found.insert(path);
            } else {
                return Err(format!(
                    "Unexpected runtime entry: {}",
                    root.join(path).display()
                ));
            }
        }
    }
    if found != files {
        return Err("Downloaded runtime is missing required files".into());
    }
    for &(relative, expected) in manifest {
        let path = root.join(relative);
        let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        if format!("{:x}", hasher.finalize()) != expected {
            return Err(format!("Runtime SHA-256 mismatch: {}", path.display()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    const ABC_DIGEST: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const MANIFEST: &[(&str, &str)] = &[("server/main.cjs", ABC_DIGEST)];

    struct Download(std::path::PathBuf);

    impl Download {
        fn new() -> Self {
            static SEQUENCE: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "revofmt-lsp-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("server")).unwrap();
            fs::write(path.join("server/main.cjs"), b"abc").unwrap();
            fs::write(path.join("LICENSE"), b"MIT").unwrap();
            Self(path)
        }
    }

    impl Drop for Download {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn admits_exact_runtime_files_and_rechecks_cached_bytes() {
        let download = Download::new();
        assert!(verify_server(&download.0, MANIFEST).is_ok());
        fs::write(download.0.join("server/main.cjs"), b"abd").unwrap();
        assert!(verify_server(&download.0, MANIFEST).is_err());
    }

    #[test]
    fn rejects_missing_and_undeclared_runtime_files() {
        let download = Download::new();
        fs::write(download.0.join("server/injected.cjs"), b"process.exit()").unwrap();
        assert!(verify_server(&download.0, MANIFEST).is_err());
        fs::remove_file(download.0.join("server/injected.cjs")).unwrap();
        fs::remove_file(download.0.join("server/main.cjs")).unwrap();
        assert!(verify_server(&download.0, MANIFEST).is_err());
    }

    #[test]
    fn rejects_empty_invalid_and_duplicate_manifests() {
        let download = Download::new();
        for manifest in [
            &[][..],
            &[("../main.cjs", ABC_DIGEST)][..],
            &[("server/main.cjs", "not a SHA256")][..],
            &[
                ("server/main.cjs", ABC_DIGEST),
                ("server/main.cjs", ABC_DIGEST),
            ][..],
        ] {
            assert!(verify_server(&download.0, manifest).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_runtime_files_and_directories() {
        use std::os::unix::fs::symlink;
        let download = Download::new();
        fs::remove_file(download.0.join("server/main.cjs")).unwrap();
        symlink(
            download.0.join("LICENSE"),
            download.0.join("server/main.cjs"),
        )
        .unwrap();
        assert!(verify_server(&download.0, MANIFEST).is_err());
        fs::remove_dir_all(download.0.join("server")).unwrap();
        let other = Download::new();
        symlink(other.0.join("server"), download.0.join("server")).unwrap();
        assert!(verify_server(&download.0, MANIFEST).is_err());
    }
}
