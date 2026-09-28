//! Bringing an image into a deck: a file dropped on the body editor, or an
//! image pasted from the clipboard, is saved under `<deck-dir>/img/` so a
//! Markdown image can reference it (`![](img/photo.png)`).
//!
//! The rules follow what peitho-core accepts for a Markdown image
//! (`RawImagePath::new` in `crates/peitho-core/src/domain.rs`): only
//! `png`, `jpg`, `jpeg`, `gif` and `webp`, as a deck-relative path. The
//! saved name is always plain ASCII (letters, digits, `-`, `_`), since
//! peitho-core's hashed output name (`ResolvedImagePath::from_hashed_asset`)
//! rejects URL delimiters that a raw file name could carry. `img/` rather
//! than `assets/`: `assets/` is the build output's namespace, and the asset
//! server serves `deck_dir/assets/*` directly as a fallback
//! (`engine::serve`).
//!
//! Naming is pure (`image_file_name`, `choose_image_path`); only
//! `import_image`/`import_image_file` touch the disk.

use std::io::Write as _;
use std::path::{Path, PathBuf};

/// The folder, relative to the deck's own, that imported images go into.
pub const IMAGE_DIR: &str = "img";

/// Used when a name has nothing left after dropping unsafe characters
/// (`スクリーンショット.png`, `   .png`).
const FALLBACK_STEM: &str = "image";

/// Long enough for any real file name, short enough to stay readable in
/// the Markdown.
const MAX_STEM_CHARS: usize = 64;

/// How many numbered names (`photo-2.png` .. `photo-999.png`) are tried
/// before giving up.
const MAX_NAME_ATTEMPTS: u32 = 999;

/// An image format peitho-core can show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl ImageFormat {
    /// The format a (lowercase) file extension names, if it is one
    /// peitho-core accepts.
    fn from_extension(extension: &str) -> Option<Self> {
        match extension {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "gif" => Some(Self::Gif),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }
}

/// The format `bytes` are actually in, read from their leading magic
/// bytes, or `None` for anything else (an SVG, a TIFF, a text file named
/// `.png`).
pub fn sniff_image_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageFormat::Png)
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some(ImageFormat::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageFormat::Gif)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageFormat::Webp)
    } else {
        None
    }
}

/// `stem` reduced to ASCII letters, digits, `-` and `_`: every run of
/// anything else becomes one `-`, and `-` is trimmed from both ends. `None`
/// when nothing is left.
fn safe_stem(stem: &str) -> Option<String> {
    let mut safe = String::new();
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            safe.push(c);
        } else if !safe.ends_with('-') {
            safe.push('-');
        }
    }
    let trimmed: String = safe.trim_matches('-').chars().take(MAX_STEM_CHARS).collect();
    let trimmed = trimmed.trim_end_matches('-');
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The name an image called `source_name` (a file name, or a path — only
/// its last component counts) is saved under: a safe ASCII stem (see
/// `safe_stem`, falling back to `image`) and its extension lowercased.
/// Refuses a name whose extension peitho-core can't show (an SVG, a TIFF,
/// no extension at all).
pub fn image_file_name(source_name: &str) -> Result<(String, ImageFormat), String> {
    let base = source_name.rsplit(['/', '\\']).next().unwrap_or(source_name);
    let (stem, extension) = base
        .rsplit_once('.')
        .ok_or_else(|| format!("{base} has no file extension; use a PNG, JPEG, GIF or WebP image"))?;
    let extension = extension.to_ascii_lowercase();
    let format = ImageFormat::from_extension(&extension)
        .ok_or_else(|| format!("{base} is not an image Peitho can show; use a PNG, JPEG, GIF or WebP image"))?;
    let stem = safe_stem(stem).unwrap_or_else(|| FALLBACK_STEM.to_string());
    Ok((format!("{stem}.{extension}"), format))
}

/// What already sits at a candidate path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Occupant {
    /// Nothing: the image can be written there.
    Vacant,
    /// A file with the very same bytes: the image is already there.
    SameContent,
    /// Anything else (another file, a folder, a symlink).
    Other,
}

/// Where an image goes, relative to the deck's folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageTarget {
    /// `img/<name>`, with `/` whatever the platform — ready for Markdown.
    pub relative_path: String,
    /// `false` when the same image is already at `relative_path`.
    pub needs_write: bool,
}

/// The first of `img/<name>`, `img/<stem>-2.<ext>`, `img/<stem>-3.<ext>`,
/// ... that is free or already holds the same image, asking `occupant` what
/// sits at each (relative path).
pub fn choose_image_path(file_name: &str, occupant: impl Fn(&str) -> Occupant) -> Result<ImageTarget, String> {
    let (stem, extension) = file_name.rsplit_once('.').unwrap_or((file_name, ""));
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let name = if attempt == 1 { file_name.to_string() } else { format!("{stem}-{attempt}.{extension}") };
        let relative_path = format!("{IMAGE_DIR}/{name}");
        match occupant(&relative_path) {
            Occupant::Vacant => return Ok(ImageTarget { relative_path, needs_write: true }),
            Occupant::SameContent => return Ok(ImageTarget { relative_path, needs_write: false }),
            Occupant::Other => {}
        }
    }
    Err(format!("{IMAGE_DIR}/ already has {MAX_NAME_ATTEMPTS} images named like {file_name}"))
}

/// What sits at `path`, without following a symlink there (writing through
/// one could land outside the deck).
fn occupant_on_disk(path: &Path, bytes: &[u8]) -> Occupant {
    match std::fs::symlink_metadata(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Occupant::Vacant,
        Ok(metadata) if metadata.is_file() => match std::fs::read(path) {
            Ok(existing) if existing == bytes => Occupant::SameContent,
            _ => Occupant::Other,
        },
        _ => Occupant::Other,
    }
}

/// `<deck_dir>/img`, created if missing, refused when it isn't a folder
/// inside the deck's (a file named `img`, or a symlink out of the deck).
fn image_dir(deck_dir: &Path) -> Result<PathBuf, String> {
    let dir = deck_dir.join(IMAGE_DIR);
    if std::fs::symlink_metadata(&dir).is_err() {
        std::fs::create_dir(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;
    }
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let deck_abs = std::fs::canonicalize(deck_dir).map_err(|err| format!("failed to resolve {}: {err}", deck_dir.display()))?;
    let dir_abs = std::fs::canonicalize(&dir).map_err(|err| format!("failed to resolve {}: {err}", dir.display()))?;
    if !dir_abs.starts_with(&deck_abs) {
        return Err(format!("{} points outside the deck's folder", dir.display()));
    }
    Ok(dir)
}

/// Saves `bytes` (an image called `source_name`) under `<deck_dir>/img/`
/// and returns its deck-relative path (`img/photo.png`). The bytes must be
/// in the format the name's extension says (`jpg` and `jpeg` alike). An
/// existing file is never overwritten: the same image already there is
/// reused, anything else gets the next numbered name.
pub fn import_image(deck_dir: &Path, source_name: &str, bytes: &[u8]) -> Result<String, String> {
    let (file_name, format) = image_file_name(source_name)?;
    if sniff_image_format(bytes) != Some(format) {
        return Err(format!("{source_name} is not a valid {format:?} image"));
    }
    image_dir(deck_dir)?;
    let target = choose_image_path(&file_name, |relative_path| {
        occupant_on_disk(&deck_dir.join(relative_path), bytes)
    })?;
    if target.needs_write {
        let path = deck_dir.join(&target.relative_path);
        // `create_new`: something that appeared since `choose_image_path`
        // looked is left alone rather than overwritten.
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|err| format!("failed to write {}: {err}", path.display()))?;
        file.write_all(bytes).map_err(|err| format!("failed to write {}: {err}", path.display()))?;
    }
    Ok(target.relative_path)
}

/// Copies the image file at `source` into `<deck_dir>/img/` (see
/// `import_image`) and returns its deck-relative path. Only an image file
/// is ever read: the name's extension is checked before its bytes.
pub fn import_image_file(deck_dir: &Path, source: &Path) -> Result<String, String> {
    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no file name", source.display()))?;
    image_file_name(source_name)?;
    if !source.is_file() {
        return Err(format!("{} is not a file", source.display()));
    }
    let bytes = std::fs::read(source).map_err(|err| format!("failed to read {}: {err}", source.display()))?;
    import_image(deck_dir, source_name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const OTHER_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDRother";
    const JPEG: &[u8] = b"\xff\xd8\xff\xe0\0\x10JFIF";
    const GIF: &[u8] = b"GIF89a\x01\0\x01\0";
    const WEBP: &[u8] = b"RIFF\x24\0\0\0WEBPVP8 ";

    fn vacant(_: &str) -> Occupant {
        Occupant::Vacant
    }

    // --- sniff_image_format ---

    #[test]
    fn given_each_supported_format_when_sniffed_then_it_is_recognized() {
        assert_eq!(sniff_image_format(PNG), Some(ImageFormat::Png));
        assert_eq!(sniff_image_format(JPEG), Some(ImageFormat::Jpeg));
        assert_eq!(sniff_image_format(GIF), Some(ImageFormat::Gif));
        assert_eq!(sniff_image_format(b"GIF87a"), Some(ImageFormat::Gif));
        assert_eq!(sniff_image_format(WEBP), Some(ImageFormat::Webp));
    }

    #[test]
    fn given_bytes_that_are_not_a_supported_image_when_sniffed_then_nothing_is_recognized() {
        for bytes in [
            &b""[..],
            b"\x89PN",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            b"II*\0",
            b"MM\0*",
            b"hello, world",
            b"RIFF\0\0\0\0WAVEfmt ",
            b"RIFF\0\0\0\0WEB",
        ] {
            assert_eq!(sniff_image_format(bytes), None, "{bytes:?}");
        }
    }

    // --- image_file_name ---

    #[test]
    fn given_a_plain_image_name_when_named_then_it_is_kept() {
        assert_eq!(image_file_name("photo.png"), Ok(("photo.png".to_string(), ImageFormat::Png)));
        assert_eq!(image_file_name("my_chart-2.webp"), Ok(("my_chart-2.webp".to_string(), ImageFormat::Webp)));
    }

    #[test]
    fn given_an_uppercase_extension_when_named_then_it_is_lowercased() {
        assert_eq!(image_file_name("Photo.PNG"), Ok(("Photo.png".to_string(), ImageFormat::Png)));
        assert_eq!(image_file_name("x.JPEG"), Ok(("x.jpeg".to_string(), ImageFormat::Jpeg)));
    }

    #[test]
    fn given_a_full_path_when_named_then_only_the_last_component_counts() {
        assert_eq!(image_file_name("/Users/me/Desktop/shot.png").unwrap().0, "shot.png");
        assert_eq!(image_file_name("C:\\pics\\shot.gif").unwrap().0, "shot.gif");
    }

    #[test]
    fn given_spaces_and_punctuation_when_named_then_each_run_becomes_one_hyphen() {
        assert_eq!(image_file_name("Screen Shot 2026-09-25 at 14.30.12.png").unwrap().0, "Screen-Shot-2026-09-25-at-14-30-12.png");
        assert_eq!(image_file_name("a.tar.png").unwrap().0, "a-tar.png");
        assert_eq!(image_file_name("(draft) chart!!.png").unwrap().0, "draft-chart.png");
    }

    #[test]
    fn given_a_name_with_nothing_safe_left_when_named_then_it_falls_back_to_image() {
        for name in ["スクリーンショット.png", "   .png", ".png", "---.png", "🙂.jpg"] {
            let (file_name, _) = image_file_name(name).unwrap();
            assert!(file_name == "image.png" || file_name == "image.jpg", "{name} -> {file_name}");
        }
    }

    #[test]
    fn given_a_mixed_non_ascii_name_when_named_then_the_ascii_part_survives() {
        assert_eq!(image_file_name("図1 overview.png").unwrap().0, "1-overview.png");
    }

    #[test]
    fn given_path_traversal_or_separators_in_a_name_when_named_then_no_separator_or_dotdot_survives() {
        for name in ["../../etc/passwd.png", "..\\x.png", "a/../b.png", "..png", "....png"] {
            let (file_name, _) = image_file_name(name).unwrap();
            assert!(!file_name.contains('/') && !file_name.contains('\\') && !file_name.contains(".."), "{name} -> {file_name}");
        }
    }

    #[test]
    fn given_a_very_long_name_when_named_then_the_stem_is_capped() {
        let (file_name, _) = image_file_name(&format!("{}.png", "a".repeat(500))).unwrap();
        assert_eq!(file_name, format!("{}.png", "a".repeat(MAX_STEM_CHARS)));
    }

    #[test]
    fn given_a_format_peitho_core_cannot_show_when_named_then_it_is_refused() {
        for name in ["diagram.svg", "scan.tiff", "notes.txt", "photo.heic", "archive.png.zip", "noextension", "", "png"] {
            assert!(image_file_name(name).is_err(), "{name}");
        }
    }

    // --- choose_image_path ---

    #[test]
    fn given_a_free_name_when_placed_then_it_goes_into_img_and_is_written() {
        assert_eq!(
            choose_image_path("photo.png", vacant),
            Ok(ImageTarget { relative_path: "img/photo.png".to_string(), needs_write: true })
        );
    }

    #[test]
    fn given_the_same_image_already_there_when_placed_then_it_is_reused_not_written_again() {
        let target = choose_image_path("photo.png", |_| Occupant::SameContent).unwrap();
        assert_eq!(target, ImageTarget { relative_path: "img/photo.png".to_string(), needs_write: false });
    }

    #[test]
    fn given_a_different_image_with_that_name_when_placed_then_the_next_number_is_used() {
        let target = choose_image_path("photo.png", |path| if path == "img/photo.png" { Occupant::Other } else { Occupant::Vacant }).unwrap();
        assert_eq!(target, ImageTarget { relative_path: "img/photo-2.png".to_string(), needs_write: true });
    }

    #[test]
    fn given_the_same_image_under_a_numbered_name_when_placed_then_that_one_is_reused() {
        let target = choose_image_path("photo.png", |path| match path {
            "img/photo.png" | "img/photo-2.png" => Occupant::Other,
            "img/photo-3.png" => Occupant::SameContent,
            _ => Occupant::Vacant,
        })
        .unwrap();
        assert_eq!(target, ImageTarget { relative_path: "img/photo-3.png".to_string(), needs_write: false });
    }

    #[test]
    fn given_every_numbered_name_taken_when_placed_then_it_is_an_error_not_an_endless_loop() {
        assert!(choose_image_path("photo.png", |_| Occupant::Other).is_err());
    }

    // --- import_image (disk) ---

    fn deck_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn given_a_deck_without_img_when_an_image_is_imported_then_img_is_created_and_the_bytes_saved() {
        let deck = deck_dir();
        assert_eq!(import_image(deck.path(), "photo.png", PNG), Ok("img/photo.png".to_string()));
        assert_eq!(std::fs::read(deck.path().join("img/photo.png")).unwrap(), PNG);
    }

    #[test]
    fn given_the_same_image_imported_twice_when_imported_then_the_first_file_is_reused() {
        let deck = deck_dir();
        import_image(deck.path(), "photo.png", PNG).unwrap();
        assert_eq!(import_image(deck.path(), "photo.png", PNG), Ok("img/photo.png".to_string()));
        assert_eq!(std::fs::read_dir(deck.path().join("img")).unwrap().count(), 1);
    }

    #[test]
    fn given_a_different_image_with_the_same_name_when_imported_then_it_is_saved_under_a_numbered_name() {
        let deck = deck_dir();
        import_image(deck.path(), "photo.png", PNG).unwrap();
        assert_eq!(import_image(deck.path(), "photo.png", OTHER_PNG), Ok("img/photo-2.png".to_string()));
        assert_eq!(std::fs::read(deck.path().join("img/photo.png")).unwrap(), PNG, "the first image is untouched");
        assert_eq!(std::fs::read(deck.path().join("img/photo-2.png")).unwrap(), OTHER_PNG);
    }

    #[test]
    fn given_jpg_and_jpeg_names_when_imported_then_both_take_jpeg_bytes() {
        let deck = deck_dir();
        assert_eq!(import_image(deck.path(), "a.jpg", JPEG), Ok("img/a.jpg".to_string()));
        assert_eq!(import_image(deck.path(), "b.JPEG", JPEG), Ok("img/b.jpeg".to_string()));
        assert_eq!(import_image(deck.path(), "c.gif", GIF), Ok("img/c.gif".to_string()));
        assert_eq!(import_image(deck.path(), "d.webp", WEBP), Ok("img/d.webp".to_string()));
    }

    #[test]
    fn given_bytes_that_do_not_match_the_extension_when_imported_then_nothing_is_written() {
        let deck = deck_dir();
        for (name, bytes) in [("fake.png", &b"not an image"[..]), ("fake.png", JPEG), ("empty.png", b""), ("x.gif", PNG)] {
            assert!(import_image(deck.path(), name, bytes).is_err(), "{name}");
        }
        assert!(!deck.path().join("img").exists(), "img/ is only created for an image that is saved");
    }

    #[test]
    fn given_an_unsupported_extension_when_imported_then_nothing_is_written() {
        let deck = deck_dir();
        assert!(import_image(deck.path(), "diagram.svg", b"<svg/>").is_err());
        assert!(!deck.path().join("img").exists());
    }

    #[test]
    fn given_a_file_named_img_when_imported_then_it_is_an_error_and_the_file_is_untouched() {
        let deck = deck_dir();
        std::fs::write(deck.path().join("img"), "not a folder").unwrap();
        let err = import_image(deck.path(), "photo.png", PNG).unwrap_err();
        assert!(err.contains("not a folder"), "{err}");
        assert_eq!(std::fs::read_to_string(deck.path().join("img")).unwrap(), "not a folder");
    }

    #[cfg(unix)]
    #[test]
    fn given_img_is_a_symlink_out_of_the_deck_when_imported_then_nothing_is_written_outside() {
        let deck = deck_dir();
        let outside = deck_dir();
        std::os::unix::fs::symlink(outside.path(), deck.path().join("img")).unwrap();
        let err = import_image(deck.path(), "photo.png", PNG).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn given_a_symlink_inside_img_with_the_wanted_name_when_imported_then_it_is_not_written_through() {
        let deck = deck_dir();
        let outside = deck_dir();
        let target = outside.path().join("victim.png");
        std::fs::write(&target, OTHER_PNG).unwrap();
        std::fs::create_dir(deck.path().join("img")).unwrap();
        std::os::unix::fs::symlink(&target, deck.path().join("img/photo.png")).unwrap();

        assert_eq!(import_image(deck.path(), "photo.png", PNG), Ok("img/photo-2.png".to_string()));
        assert_eq!(std::fs::read(&target).unwrap(), OTHER_PNG);
    }

    #[test]
    fn given_a_folder_where_the_name_would_go_when_imported_then_the_next_number_is_used() {
        let deck = deck_dir();
        std::fs::create_dir_all(deck.path().join("img/photo.png")).unwrap();
        assert_eq!(import_image(deck.path(), "photo.png", PNG), Ok("img/photo-2.png".to_string()));
    }

    // --- import_image_file ---

    #[test]
    fn given_a_dropped_image_file_when_imported_then_it_is_copied_under_a_safe_name() {
        let deck = deck_dir();
        let desktop = deck_dir();
        let source = desktop.path().join("Screen Shot 1.png");
        std::fs::write(&source, PNG).unwrap();

        assert_eq!(import_image_file(deck.path(), &source), Ok("img/Screen-Shot-1.png".to_string()));
        assert_eq!(std::fs::read(deck.path().join("img/Screen-Shot-1.png")).unwrap(), PNG);
        assert!(source.is_file(), "the dropped file itself stays where it was");
    }

    #[test]
    fn given_a_file_already_in_the_decks_img_when_dropped_then_it_is_reused_in_place() {
        let deck = deck_dir();
        std::fs::create_dir(deck.path().join("img")).unwrap();
        let source = deck.path().join("img/photo.png");
        std::fs::write(&source, PNG).unwrap();

        assert_eq!(import_image_file(deck.path(), &source), Ok("img/photo.png".to_string()));
        assert_eq!(std::fs::read_dir(deck.path().join("img")).unwrap().count(), 1);
    }

    #[test]
    fn given_a_dropped_file_that_is_not_an_image_when_imported_then_it_is_not_even_read() {
        let deck = deck_dir();
        let desktop = deck_dir();
        let notes = desktop.path().join("notes.txt");
        std::fs::write(&notes, "hello").unwrap();

        assert!(import_image_file(deck.path(), &notes).is_err());
        assert!(import_image_file(deck.path(), desktop.path()).is_err(), "a folder");
        assert!(import_image_file(deck.path(), &desktop.path().join("missing.png")).is_err());
        assert!(import_image_file(deck.path(), Path::new("")).is_err());
        assert!(!deck.path().join("img").exists());
    }
}
