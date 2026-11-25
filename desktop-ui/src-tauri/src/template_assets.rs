/// A licensed built-in template uses the exact vendored SVG for stitch generation.
pub fn twemoji_document(id: &str, width_mm: f64) -> Option<String> {
    let artwork = match id {
        "twemoji-dragon" => include_str!("../../src/assets/twemoji/1f409.svg"),
        "twemoji-robot" => include_str!("../../src/assets/twemoji/1f916.svg"),
        "twemoji-ghost" => include_str!("../../src/assets/twemoji/1f47b.svg"),
        "twemoji-cat" => include_str!("../../src/assets/twemoji/1f431.svg"),
        "twemoji-fox" => include_str!("../../src/assets/twemoji/1f98a.svg"),
        "twemoji-rabbit" => include_str!("../../src/assets/twemoji/1f430.svg"),
        "twemoji-otter" => include_str!("../../src/assets/twemoji/1f9a6.svg"),
        "twemoji-unicorn" => include_str!("../../src/assets/twemoji/1f984.svg"),
        "twemoji-birthday-cake" => include_str!("../../src/assets/twemoji/1f382.svg"),
        "twemoji-jack-o-lantern" => include_str!("../../src/assets/twemoji/1f383.svg"),
        "twemoji-christmas-tree" => include_str!("../../src/assets/twemoji/1f384.svg"),
        "twemoji-bouquet" => include_str!("../../src/assets/twemoji/1f490.svg"),
        "twemoji-wrapped-gift" => include_str!("../../src/assets/twemoji/1f381.svg"),
        "twemoji-ribbon" => include_str!("../../src/assets/twemoji/1f380.svg"),
        "twemoji-butterfly" => include_str!("../../src/assets/twemoji/1f98b.svg"),
        _ => return None,
    };
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm}mm" height="{width_mm}mm" viewBox="0 0 100 100">{artwork}</svg>"#,
    ))
}
