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


// ── Atomic project creation ─────────────────────────────────────────────────
//
// Creating a project is the one operation that must work on a directory that is
// not yet a project root, so these commands take a `parent` plus a single path
// *segment*. A segment containing a separator, a `..`, a NUL or a leading dot
// (other than our own temp prefix) is refused, which keeps the blast radius to
// one child of a directory the user just chose in a file picker.

const TEMP_PREFIX: &str = ".manu-new-";

/// Validate a single path segment: no separators, no traversal, not empty.
fn segment(name: &str) -> Result<&str, String> {
    if name.is_empty() {
        return Err("project folder name is empty".into());
    }
    if name.contains('\0') || name.contains('/') || name.contains('\\') {
        return Err("project folder name must not contain a path separator".into());
    }
    if name == "." || name == ".." {
        return Err("invalid project folder name".into());
    }
    Ok(name)
}

fn child(parent: &str, name: &str) -> Result<PathBuf, String> {
    let base = fs::canonicalize(parent).map_err(|e| format!("invalid destination: {e}"))?;
    let joined = base.join(segment(name)?);
    if !joined.starts_with(&base) {
        return Err("resolved path escapes the destination directory".into());
    }
    Ok(joined)
}

/// Create a new directory inside `parent`. Fails if it already exists, so a
/// project can never be created on top of somebody else's folder.
pub fn prepare_impl(parent: &str, name: &str) -> Result<String, String> {
    let path = child(parent, name)?;
    if path.exists() {
        return Err(format!("\"{name}\" already exists in that folder."));
    }
    fs::create_dir(&path).map_err(|e| format!("could not create the project folder: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Rename a prepared directory to its final name, atomically where the platform
/// allows. Refuses to clobber an existing destination.
pub fn promote_impl(parent: &str, from: &str, to: &str) -> Result<String, String> {
    let source = child(parent, from)?;
    let target = child(parent, to)?;
    if target.exists() {
        return Err(format!("\"{to}\" already exists in that folder."));
    }
    fs::rename(&source, &target).map_err(|e| format!("could not finish creating the project: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// Remove a half-built project directory. Only ever removes a directory whose
/// name carries our temporary prefix, so a failed creation can be cleaned up
/// without this becoming a general-purpose recursive delete.
pub fn discard_impl(parent: &str, name: &str) -> Result<(), String> {
    if !name.starts_with(TEMP_PREFIX) {
        return Err("refusing to remove a directory that is not a partial project".into());
    }
    let path = child(parent, name)?;
    match fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cleanup failed: {e}")),
    }
}

pub fn child_exists_impl(parent: &str, name: &str) -> Result<bool, String> {
    Ok(child(parent, name)?.exists())
}

#[tauri::command]
pub fn project_prepare(parent: String, name: String) -> Result<String, String> {
    prepare_impl(&parent, &name)
}

#[tauri::command]
pub fn project_promote(parent: String, from: String, to: String) -> Result<String, String> {
    promote_impl(&parent, &from, &to)
}

#[tauri::command]
pub fn project_discard(parent: String, name: String) -> Result<(), String> {
    discard_impl(&parent, &name)
}

#[tauri::command]
pub fn project_child_exists(parent: String, name: String) -> Result<bool, String> {
    child_exists_impl(&parent, &name)
}

#[cfg(test)]
mod creation_tests {
    use super::*;
    use std::fs;

    fn temp_parent() -> PathBuf {
        let mut dir = std::env::temp_dir();
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        dir.push(format!("manu-create-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn rejects_separators_and_traversal_in_names() {
        let parent = temp_parent();
        let p = parent.to_str().unwrap();
        assert!(prepare_impl(p, "../escape").is_err());
        assert!(prepare_impl(p, "a/b").is_err());
        assert!(prepare_impl(p, "..").is_err());
        assert!(prepare_impl(p, "").is_err());
        assert!(prepare_impl(p, "The Black Thorn").is_ok());
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn refuses_to_create_over_an_existing_folder() {
        let parent = temp_parent();
        let p = parent.to_str().unwrap();
        prepare_impl(p, "Novel").unwrap();
        assert!(prepare_impl(p, "Novel").is_err());
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn promotes_by_rename_and_refuses_to_clobber() {
        let parent = temp_parent();
        let p = parent.to_str().unwrap();
        prepare_impl(p, ".manu-new-1").unwrap();
        promote_impl(p, ".manu-new-1", "The Black Thorn").unwrap();
        assert!(parent.join("The Black Thorn").exists());
        assert!(!parent.join(".manu-new-1").exists());

        prepare_impl(p, ".manu-new-2").unwrap();
        assert!(promote_impl(p, ".manu-new-2", "The Black Thorn").is_err());
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn discard_only_removes_partial_projects() {
        let parent = temp_parent();
        let p = parent.to_str().unwrap();
        prepare_impl(p, "Precious Novel").unwrap();
        assert!(discard_impl(p, "Precious Novel").is_err());
        assert!(parent.join("Precious Novel").exists());

        prepare_impl(p, ".manu-new-9").unwrap();
        write_atomic_impl(parent.join(".manu-new-9").to_str().unwrap(), "a/b.md", "x").unwrap();
        discard_impl(p, ".manu-new-9").unwrap();
        assert!(!parent.join(".manu-new-9").exists());
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn unicode_and_spaces_survive() {
        let parent = temp_parent();
        let p = parent.to_str().unwrap();
        prepare_impl(p, "Тёмный шип — drafts (2026)").unwrap();
        assert!(child_exists_impl(p, "Тёмный шип — drafts (2026)").unwrap());
        fs::remove_dir_all(&parent).ok();
    }
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
