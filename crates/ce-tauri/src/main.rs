// The whole runtime lives in lib.rs so it can be reused by the
// generated mobile entry point. The desktop binary just delegates here.
fn main() {
    ce_tauri_lib::run();
}
