//! Reading a user-chosen manuscript in, and writing a user-chosen export out.
//!
//! These are the only two commands that touch paths outside a project folder,
//! and both operate on exactly one file the user picked in a native dialog.
//! Imports never write to the source (§2); exports write atomically via a
//! sibling temp file so a crash cannot leave a half-written document.
//!
//! Bytes cross the IPC boundary as base64 — implemented here rather than
//! pulled in as a dependency, because forty lines beat a supply chain.

use std::fs;
use std::path::Path;

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn to_base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        out.push(ALPHABET[(b[0] >> 2) as usize] as char);
        out.push(ALPHABET[(((b[0] & 0x03) << 4) | (b[1] >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(((b[1] & 0x0f) << 2) | (b[2] >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(b[2] & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

pub fn from_base64(text: &str) -> Result<Vec<u8>, String> {
    let mut values: Vec<u8> = Vec::with_capacity(text.len());
    for ch in text.bytes() {
        match ch {
            b'A'..=b'Z' => values.push(ch - b'A'),
            b'a'..=b'z' => values.push(ch - b'a' + 26),
            b'0'..=b'9' => values.push(ch - b'0' + 52),
            b'+' => values.push(62),
            b'/' => values.push(63),
            b'=' | b'\n' | b'\r' => {}
            _ => return Err("Invalid base64 input.".into()),
        }
    }
    let mut out = Vec::with_capacity(values.len() * 3 / 4);
    for chunk in values.chunks(4) {
        if chunk.len() >= 2 {
            out.push((chunk[0] << 2) | (chunk[1] >> 4));
        }
        if chunk.len() >= 3 {
            out.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        if chunk.len() == 4 {
            out.push((chunk[2] << 6) | chunk[3]);
        }
    }
    Ok(out)
}

fn require_absolute(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Only absolute paths chosen in a file dialog are accepted.".into());
    }
    Ok(p)
}

pub fn read_external_impl(path: &str) -> Result<String, String> {
    let p = require_absolute(path)?;
    let bytes = fs::read(p).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(to_base64(&bytes))
}

pub fn write_external_impl(path: &str, contents_base64: &str) -> Result<(), String> {
    let p = require_absolute(path)?;
    let bytes = from_base64(contents_base64)?;
    let parent = p
        .parent()
        .ok_or_else(|| "Path has no parent directory.".to_string())?;
    if !parent.exists() {
        return Err(format!("Directory {} does not exist.", parent.display()));
    }
    let tmp = parent.join(format!(
        ".{}.manu-tmp",
        p.file_name().and_then(|n| n.to_str()).unwrap_or("export")
    ));
    fs::write(&tmp, &bytes).map_err(|e| format!("Could not write export: {e}"))?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not finish writing {path}: {e}")
    })
}

#[tauri::command]
pub fn external_read(path: String) -> Result<String, String> {
    read_external_impl(&path)
}

#[tauri::command]
pub fn external_write(path: String, contents_base64: String) -> Result<(), String> {
    write_external_impl(&path, &contents_base64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn base64_round_trips_all_lengths() {
        for len in 0..10usize {
            let data: Vec<u8> = (0..len as u8).map(|b| b.wrapping_mul(37)).collect();
            assert_eq!(from_base64(&to_base64(&data)).unwrap(), data);
        }
        let binary: Vec<u8> = (0..=255u8).collect();
        assert_eq!(from_base64(&to_base64(&binary)).unwrap(), binary);
    }

    #[test]
    fn writes_atomically_and_reads_back() {
        let dir = temp_dir().join(format!("manu-external-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("export.docx");
        let payload = to_base64(b"PK\x03\x04 manuscript bytes");
        write_external_impl(file.to_str().unwrap(), &payload).unwrap();
        let back = read_external_impl(file.to_str().unwrap()).unwrap();
        assert_eq!(from_base64(&back).unwrap(), b"PK\x03\x04 manuscript bytes");
        // No temp file left behind.
        assert!(fs::read_dir(&dir).unwrap().count() == 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_relative_paths_and_missing_directories() {
        assert!(read_external_impl("relative.docx").is_err());
        assert!(write_external_impl("relative.docx", "QQ==").is_err());
        let ghost = temp_dir().join("manu-does-not-exist-xyz").join("f.txt");
        assert!(write_external_impl(ghost.to_str().unwrap(), "QQ==").is_err());
    }
}
