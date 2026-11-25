use super::{Document, elements_by_id, root_prefix_len, xml_escape};
use crate::design::{Design, PlanCache};
use anyhow::{Result, bail};
use std::collections::HashMap;

const LABEL: &str = "data-ss-layer-name";
const LOCKED: &str = "data-ss-layer-locked";
const HIDDEN: &str = "data-ss-layer-hidden";

/// Editor properties shared by the fill and stroke of an SVG element.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LayerProperties {
    pub name: Option<String>,
    pub locked: bool,
    pub hidden: bool,
}

pub(super) fn read_layer_properties(
    xml: &roxmltree::Document<'_>,
) -> HashMap<String, LayerProperties> {
    xml.descendants()
        .filter(|node| node.is_element())
        .filter_map(|node| {
            let id = node.attribute("id")?;
            let properties = LayerProperties {
                name: node.attribute(LABEL).filter(|value| !value.is_empty()).map(str::to_owned),
                locked: node.attribute(LOCKED) == Some("1"),
                hidden: node.attribute(HIDDEN) == Some("1"),
            };
            (properties != LayerProperties::default()).then(|| (id.to_owned(), properties))
        })
        .collect()
}

impl Document {
    pub fn layer_properties(&self, id: &str) -> Option<&LayerProperties> {
        self.layer_properties.get(id)
    }

    /// Save layer properties on the source element without rebuilding its geometry.
    pub fn set_layer_properties(&mut self, index: usize, properties: LayerProperties) -> Result<()> {
        let id = self.shapes.get(index).ok_or_else(|| anyhow::anyhow!("Object not found"))?.id.clone();
        if properties.name.as_ref().is_some_and(|name| {
            name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control)
        }) {
            bail!("Enter a layer name between 1 and 80 characters");
        }

        let doc = roxmltree::Document::parse(&self.xml)?;
        let elements = elements_by_id(&doc);
        let node = elements.get(id.as_str()).ok_or_else(|| anyhow::anyhow!("Object not found"))?;
        let opening = node.range().start;
        let insert_at = opening + 1 + root_prefix_len(&self.xml, opening) + node.tag_name().name().len();
        let mut inserts = String::new();
        let mut edits = Vec::new();
        for (name, value) in [
            (LABEL, properties.name.as_deref().unwrap_or("")),
            (LOCKED, if properties.locked { "1" } else { "0" }),
            (HIDDEN, if properties.hidden { "1" } else { "0" }),
        ] {
            let write_new = (name == LABEL && !value.is_empty()) || (name != LABEL && value == "1");
            if let Some(attribute) = node.attributes().find(|attribute| attribute.name() == name) {
                edits.push((attribute.range_value(), xml_escape(value).replace('\'', "&apos;")));
            } else if write_new {
                inserts.push_str(&format!(" {name}=\"{}\"", xml_escape(value)));
            }
        }
        edits.push((insert_at..insert_at, inserts));
        edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
        for (range, replacement) in edits {
            self.xml.replace_range(range, &replacement);
        }
        if properties == LayerProperties::default() {
            self.layer_properties.remove(&id);
        } else {
            self.layer_properties.insert(id, properties);
        }
        self.rev = super::next_rev();
        Ok(())
    }

    pub(super) fn plan_visible_layers(&self, cache: &mut PlanCache) -> Design {
        let options = self.plan_options();
        if !self.layer_properties.values().any(|properties| properties.hidden) {
            return crate::design::plan_cached(&self.name, &self.shapes, &options, cache);
        }
        // Omit hidden geometry from stitch generation, overlap subtraction and
        // automatic routing. Result indices still address the complete document.
        let (visible_indices, visible): (Vec<usize>, Vec<_>) = self.shapes.iter().enumerate()
            .filter(|(_, shape)| !self.layer_properties(&shape.id).is_some_and(|layer| layer.hidden))
            .map(|(index, shape)| (index, shape.clone()))
            .unzip();
        let mut plan = crate::design::plan_cached(&self.name, &visible, &options, cache);
        let counts = std::mem::replace(&mut plan.per_shape, vec![0; self.shapes.len()]);
        let covered = std::mem::replace(&mut plan.covered, vec![false; self.shapes.len()]);
        for ((index, count), is_covered) in visible_indices.iter().copied().zip(counts).zip(covered) {
            plan.per_shape[index] = count;
            plan.covered[index] = is_covered;
        }
        for index in plan.sew_order.iter_mut()
            .chain(plan.block_shapes.iter_mut().flatten())
            .chain(plan.notes.iter_mut().map(|(index, _)| index))
        {
            *index = visible_indices[*index];
        }
        plan
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::dst::write_dst;

    #[test]
    fn layer_metadata_round_trips_with_the_svg_and_hides_only_the_requested_element() {
        let xml = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
            <rect id="lower" x="2" y="2" width="18" height="18" fill="#7645a2"/>
            <rect id="upper" x="6" y="6" width="10" height="10" fill="#cc9922"/>
        </svg>"##;
        let mut document = Document::from_svg(xml, "Layer test", None).unwrap();
        let original = write_dst(&document.plan());
        let properties = LayerProperties {
            name: Some("Moon & \"Stars\" <2026> 'test'".to_string()),
            locked: true,
            hidden: true,
        };
        document.set_layer_properties(0, properties.clone()).unwrap();
        let plan = document.plan();
        assert_eq!(plan.per_shape[0], 0);
        assert!(plan.per_shape[1] > 0);
        assert_eq!(plan.sew_order, [1]);
        assert_eq!(plan.block_shapes, [vec![1]]);
        assert_eq!(plan.blocks.len(), 1);

        let mut reopened = Document::restore_svg(
            &document.to_svg().unwrap(), "Layer test", document.offset,
        ).unwrap();
        assert_eq!(reopened.layer_properties(&reopened.shapes[0].id), Some(&properties));
        assert_eq!(reopened.plan().per_shape, plan.per_shape);
        reopened.set_layer_properties(0, LayerProperties::default()).unwrap();
        assert_eq!(write_dst(&reopened.plan()), original);
    }
}
