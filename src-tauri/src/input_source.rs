//! Switches the OS keyboard input source to one that types ASCII, for vim
//! mode: after `<Esc>` leaves insert mode, normal-mode keys (`dd`, `j`, `:`)
//! must reach the editor as-is rather than be taken by a Japanese input
//! method's conversion. The frontend calls this on entering a non-insert
//! vim mode (`dom/codeEditor.ts`).
//!
//! Holds no state, so it lives apart from `peitho.rs`. Does nothing outside
//! macOS.

/// Selects the ASCII-capable keyboard input source the user last used
/// (e.g. "ABC" or "U.S."), leaving it as is when it is already selected.
///
/// Synchronous on purpose: a synchronous command runs on the main thread,
/// and Text Input Source Services must be called from there (recent macOS
/// aborts the process when they're called from another thread).
#[tauri::command]
pub fn select_ascii_input_source() -> Result<(), String> {
    select_ascii()
}

#[cfg(target_os = "macos")]
fn select_ascii() -> Result<(), String> {
    use std::ffi::c_void;

    type TISInputSourceRef = *mut c_void;
    type OSStatus = i32;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn TISCopyCurrentASCIICapableKeyboardInputSource() -> TISInputSourceRef;
        fn TISSelectInputSource(source: TISInputSourceRef) -> OSStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    // SAFETY: the "Copy" call returns an owned reference (or null), which is
    // released exactly once after its only use.
    unsafe {
        let source = TISCopyCurrentASCIICapableKeyboardInputSource();
        if source.is_null() {
            return Err("no ASCII-capable input source is available".to_string());
        }
        let status = TISSelectInputSource(source);
        CFRelease(source);
        if status == 0 {
            Ok(())
        } else {
            Err(format!("TISSelectInputSource failed with status {status}"))
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn select_ascii() -> Result<(), String> {
    Ok(())
}
