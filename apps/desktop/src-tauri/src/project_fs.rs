//! Root-confined project filesystem commands.
//!
//! The renderer never gets unrestricted filesystem access. Every command takes
//! an absolute project `root` and a project-relative `rel`, and all access is
//! confined inside `root`; traversal (`..`), absolute paths, and NUL bytes are
//! rejected. Writes are atomic (temp file + rename) so an interrupted write
//! never corrupts a file. See docs/STORY_REPOSITORY.md and AGENTS.md.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Join a project-relative path onto a canonicalised root, rejecting anything
/// that could escape the root.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains('\0') {
        return Err("path contains a NUL byte".into());
    }
    if Path::new(rel).is_absolute() {
        return Err("absolute paths are not allowed".into());
    }

    let mut out = root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return Err("path traversal is not allowed".into()),
            normal => out.push(normal),
        }
    }

    if !out.starts_with(root) {
        return Err("resolved path escapes the project root".into());
    }
    Ok(out)
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|e| format!("invalid project root: {e}"))
}

pub fn read_text_impl(root: &str, rel: &str) -> Result<Option<String>, String> {
    let path = safe_join(&canonical_root(root)?, rel)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read failed: {e}")),
    }
}

pub fn write_atomic_impl(root: &str, rel: &str, contents: &str) -> Result<(), String> {
    let path = safe_join(&canonical_root(root)?, rel)?;
    let parent = path
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp = parent.join(format!(".{file_name}.{nanos}.tmp"));

    {
        let mut file = fs::File::create(&tmp).map_err(|e| format!("temp create failed: {e}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("temp write failed: {e}"))?;
        file.sync_all().map_err(|e| format!("fsync failed: {e}"))?;
    }

    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("atomic rename failed: {e}"));
    }
    Ok(())
}

pub fn exists_impl(root: &str, rel: &str) -> Result<bool, String> {
    let path = safe_join(&canonical_root(root)?, rel)?;
    Ok(path.exists())
}

pub fn mkdir_impl(root: &str, rel: &str) -> Result<(), String> {
    let path = safe_join(&canonical_root(root)?, rel)?;
    fs::create_dir_all(&path).map_err(|e| format!("mkdir failed: {e}"))
}

pub fn remove_impl(root: &str, rel: &str) -> Result<(), String> {
    let path = safe_join(&canonical_root(root)?, rel)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove failed: {e}")),
    }
}

pub fn list_impl(root: &str, rel: Option<&str>) -> Result<Vec<String>, String> {
    let root_path = canonical_root(root)?;
    let base = match rel {
        Some(r) if !r.is_empty() => safe_join(&root_path, r)?,
        _ => root_path.clone(),
    };
    let mut out = Vec::new();
    if base.exists() {
        walk(&base, &root_path, &mut out)?;
    }
    out.sort();
    Ok(out)
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("read_dir failed: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("dir entry failed: {e}"))?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| format!("file_type failed: {e}"))?;
        if file_type.is_dir() {
            walk(&path, root, out)?;
        } else if file_type.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

// ── Tauri command wrappers ──────────────────────────────────────────────────

#[tauri::command]
pub fn project_read_text(root: String, rel: String) -> Result<Option<String>, String> {
    read_text_impl(&root, &rel)
}

#[tauri::command]
pub fn project_write_atomic(root: String, rel: String, contents: String) -> Result<(), String> {
    write_atomic_impl(&root, &rel, &contents)
}

#[tauri::command]
pub fn project_exists(root: String, rel: String) -> Result<bool, String> {
    exists_impl(&root, &rel)
}

#[tauri::command]
pub fn project_mkdir(root: String, rel: String) -> Result<(), String> {
    mkdir_impl(&root, &rel)
}

#[tauri::command]
pub fn project_remove(root: String, rel: String) -> Result<(), String> {
    remove_impl(&root, &rel)
}

#[tauri::command]
pub fn project_list(root: String, rel: Option<String>) -> Result<Vec<String>, String> {
    list_impl(&root, rel.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root() -> PathBuf {
        let mut dir = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        dir.push(format!("manu-rs-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = temp_root();
        assert!(safe_join(&root, "../escape").is_err());
        assert!(safe_join(&root, "a/../../b").is_err());
        assert!(safe_join(&root, "/etc/passwd").is_err());
        assert!(safe_join(&root, "a\0b").is_err());
        assert!(safe_join(&root, "manuscript/ch1.md").is_ok());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_round_trips_and_leaves_no_temp() {
        let root = temp_root();
        let root_str = root.to_str().unwrap();
        write_atomic_impl(root_str, "notes/a.md", "v1").unwrap();
        write_atomic_impl(root_str, "notes/a.md", "v2").unwrap();
        assert_eq!(read_text_impl(root_str, "notes/a.md").unwrap().unwrap(), "v2");
        let leftovers: Vec<_> = fs::read_dir(root.join("notes"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn traversal_blocked_at_command_impls() {
        let root = temp_root();
        let root_str = root.to_str().unwrap();
        assert!(write_atomic_impl(root_str, "../evil.md", "x").is_err());
        assert!(!root.parent().unwrap().join("evil.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn lists_files_recursively_as_posix() {
        let root = temp_root();
        let root_str = root.to_str().unwrap();
        write_atomic_impl(root_str, "b/2.md", "").unwrap();
        write_atomic_impl(root_str, "a.md", "").unwrap();
        let listed = list_impl(root_str, None).unwrap();
        assert_eq!(listed, vec!["a.md".to_string(), "b/2.md".to_string()]);
        fs::remove_dir_all(&root).ok();
    }
}
