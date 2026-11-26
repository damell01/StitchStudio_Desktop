//! Shared layout and stitch settings for sew-out swatch sheets.
use super::{Document, TextSpec};
use crate::{
    geom::P,
    params::{Fabric, Kind, Params},
};
use anyhow::{Result, ensure};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "ocr", derive(serde::Deserialize))]
#[cfg_attr(feature = "ocr", serde(rename_all = "snake_case"))]
pub enum SwatchSetting {
    Spacing,
    Length,
    Pull,
    Width,
    Angle,
}

impl SwatchSetting {
    pub const ALL: [Self; 5] = [
        Self::Spacing,
        Self::Length,
        Self::Pull,
        Self::Width,
        Self::Angle,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::Spacing => "Spacing",
            Self::Length => "Stitch length",
            Self::Pull => "Pull compensation",
            Self::Width => "Satin width",
            Self::Angle => "Fill angle",
        }
    }

    pub fn is_length(self) -> bool {
        self != Self::Angle
    }

    pub fn applies(self, kind: Kind) -> bool {
        match self {
            Self::Spacing => matches!(kind, Kind::Fill | Kind::Satin | Kind::Contour),
            Self::Length => matches!(kind, Kind::Fill | Kind::Run | Kind::Contour),
            Self::Pull => matches!(kind, Kind::Fill | Kind::Satin),
            Self::Width => kind == Kind::Satin,
            Self::Angle => kind == Kind::Fill,
        }
    }

    pub fn default_range(self, p: &Params, fabric: &Fabric, width: f64) -> (f64, f64) {
        let round = |v: f64| (v * 100.0).round() / 100.0;
        match self {
            Self::Spacing => {
                let spacing = p.spacing.unwrap_or(fabric.fill_spacing);
                (round(spacing * 0.7), round(spacing * 1.3))
            }
            Self::Length => (2., 4.),
            Self::Pull => (0., 0.4),
            Self::Width => (round(width * 0.7), round(width * 1.3)),
            Self::Angle => (0., 90.),
        }
    }

    pub fn limits(self) -> (f64, f64) {
        match self {
            Self::Spacing => (0.1, 2.),
            Self::Length => (0.5, 10.),
            Self::Pull => (0., 1.),
            Self::Width => (0.3, 15.),
            Self::Angle => (0., 360.),
        }
    }

    fn set(self, p: &mut Params, value: f64) {
        let (min, max) = self.limits();
        let value = if self.is_length() {
            value.clamp(min, max)
        } else {
            value
        };
        match self {
            Self::Spacing => p.spacing = Some(value),
            Self::Length => p.len = Some(value),
            Self::Pull => p.pull = Some(value),
            Self::Width => p.width = Some(value),
            Self::Angle => p.angle = Some(value),
        }
    }
}

pub fn swatch_values(from: f64, to: f64, steps: usize) -> Vec<f64> {
    let steps = steps.max(1);
    (0..steps)
        .map(|index| {
            let t = if steps == 1 {
                0.
            } else {
                index as f64 / (steps - 1) as f64
            };
            ((from + (to - from) * t) * 1000.).round() / 1000.
        })
        .collect()
}

impl Document {
    /// Add a labelled grid of copies to the right of the source selection.
    pub fn add_test_swatches(
        &mut self,
        indices: &[usize],
        setting: SwatchSetting,
        values: &[f64],
        labels: &[String],
        columns: usize,
    ) -> Result<Vec<usize>> {
        ensure!(
            !indices.is_empty() && indices.iter().all(|&i| i < self.shapes.len()),
            "Select valid artwork first"
        );
        ensure!(
            !values.is_empty() && values.iter().all(|v| v.is_finite()),
            "Choose valid swatch values"
        );
        ensure!(
            labels.is_empty() || labels.len() == values.len(),
            "Each swatch needs one label"
        );

        let mut bounds = crate::geom::Bounds::empty();
        for &index in indices {
            let b = crate::svg::shapes_bounds(&self.shapes[index..=index]);
            if !b.is_empty() {
                bounds.add(b.min);
                bounds.add(b.max);
            }
        }
        ensure!(!bounds.is_empty(), "The selection has no outlines");
        let color = self.shapes[indices[0]].color;
        let gap = 30.;
        let label_height = if labels.is_empty() { 0. } else { 35. };
        let label_width = labels.iter().map(|label| label.len()).max().unwrap_or(0) as f64 * 18.;
        let cell_width = bounds.width().max(label_width) + gap;
        let cell_height = bounds.height() + gap + label_height;
        let columns = columns.max(1);
        let mut added = Vec::new();
        for (i, &value) in values.iter().enumerate() {
            let offset = P::new(
                (i % columns + 1) as f64 * cell_width,
                (i / columns) as f64 * cell_height,
            );
            let copies = self.duplicate(indices, offset)?;
            for &index in &copies {
                let params = &mut self.shapes[index].params;
                if setting.applies(params.kind.unwrap_or(Kind::Fill)) {
                    setting.set(params, value);
                }
            }
            added.extend(copies.iter().map(|&j| self.shapes[j].uid));
            if let Some(label) = labels.get(i) {
                let spec = TextSpec {
                    text: label.clone(),
                    size_mm: 2.5,
                    bold: false,
                    color,
                    kind: Kind::Run,
                    ..TextSpec::default()
                };
                let x = (bounds.center().x + offset.x) / 10.;
                let y = (bounds.max.y + offset.y + gap * 0.5 + 12.) / 10.;
                let index = self.add_lettering(&spec, (x, y))?;
                added.push(self.shapes[index].uid);
            }
        }
        self.sync()?;
        Ok(added
            .iter()
            .filter_map(|uid| self.shapes.iter().position(|shape| shape.uid == *uid))
            .collect())
    }
}
