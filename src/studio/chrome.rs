//! Window chrome: the unified title bar / toolbar, the tool strip, and the
//! status bar with the stitch player.

use crate::app::{SPM, Studio, Tool};
use crate::commands::{Action, TOOLS};
use crate::icons::Icon;
use crate::theme::{caption, icon_button, pal_ui};
use crate::widgets::fmt_int;
use eframe::egui::{self, Color32, Pos2, Rect, Sense, Stroke, Vec2};

/// Room for the traffic-light buttons when the title bar is transparent.
const TRAFFIC_LIGHTS: f32 = 70.0;

impl Studio {
    /// Quick start panel for a blank document; all actions use the native editor.
    pub fn welcome_panel(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        egui::Frame::new().fill(p.desk).inner_margin(egui::Margin::same(16)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.label(egui::RichText::new("Start a design").size(23.0).strong().color(p.text));
            caption(ui, "Choose a starting point for your next embroidery project.");
            ui.add_space(10.0);
            ui.horizontal_wrapped(|ui| {
                let width = ((ui.available_width() - 16.0) / 3.0).clamp(130.0, 240.0);
                for (label, detail, action) in [
                    ("Digitize artwork", "Convert a picture into stitches", Action::Place),
                    ("Open design", "Continue an existing project", Action::Open),
                    ("Create lettering", "Personalize with embroidery text", Action::AddText),
                ] {
                    ui.allocate_ui(Vec2::new(width, 72.0), |ui| {
                        ui.vertical(|ui| {
                            if ui.add_enabled(self.action_enabled(action),
                                egui::Button::new(egui::RichText::new(label).strong())
                                    .min_size(Vec2::new(width, 34.0))).clicked() {
                                self.run_action(action);
                            }
                            caption(ui, detail);
                        });
                    });
                }
            });
            ui.separator();
            ui.horizontal_wrapped(|ui| {
                caption(ui, "Workflow: Artwork → Threads → Inspect → Export");
                if ui.button("Quick tour").clicked() {
                    ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new("studio-tour"), 0usize));
                }
            });
        });
    }

    /// Labeled, discoverable shortcuts backed by the existing editor commands.
    pub fn workspace_toolbar(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 5.0;
            let compact = ui.available_width() < 1180.0;
            for (label, action) in [
                ("New", Action::New), ("Open", Action::Open), ("Save", Action::Save),
                ("Undo", Action::Undo), ("Redo", Action::Redo),
                ("Digitize", Action::Place), ("Lettering", Action::AddText),
                ("Center", Action::CenterInHoop),
            ] {
                let button = if label == "Digitize" {
                    egui::Button::new(egui::RichText::new(label).strong().color(
                        if p.dark { Color32::from_rgb(23, 30, 26) } else { Color32::WHITE }
                    )).fill(p.accent)
                } else { egui::Button::new(label) };
                if ui.add_enabled(self.action_enabled(action), button.min_size(Vec2::new(0.0, 28.0)))
                    .on_hover_text(if label == "Digitize" { "Import artwork and convert it into embroidery objects" } else if label == "Center" { "Center the selection or design in the hoop without resizing" } else { label })
                    .clicked() {
                    self.run_action(action);
                }
            }
            ui.separator();
            ui.menu_button("Quick actions", |ui| {
                let search_id = ui.make_persistent_id("quick-action-search");
                let mut query = ui.ctx().data(|d| d.get_temp::<String>(search_id).unwrap_or_default());
                ui.add(egui::TextEdit::singleline(&mut query).hint_text("Find any command…"));
                ui.ctx().data_mut(|d| d.insert_temp(search_id, query.clone()));
                let favorites_id = egui::Id::new("quick-action-favorites");
                let registry = crate::commands::all_actions();
                let file = crate::dock::config_file("quick-actions.json");
                let mut favorites = ui.ctx().data(|d| d.get_temp::<Vec<Action>>(favorites_id)).unwrap_or_else(|| {
                    let names: Vec<String> = file.as_ref().and_then(|f| std::fs::read_to_string(f).ok())
                        .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
                    registry.iter().filter(|(_, label, _)| names.iter().any(|n| n.as_str() == *label)).map(|(a, _, _)| *a).collect()
                });
                let save_favorites = |favorites: &[Action]| {
                    if let Some(f) = &file {
                        let names: Vec<_> = registry.iter().filter(|(a, _, _)| favorites.contains(a)).map(|(_, label, _)| *label).collect();
                        if let Some(dir) = f.parent() { let _ = std::fs::create_dir_all(dir); }
                        if let Ok(json) = serde_json::to_string(&names) { let _ = std::fs::write(f, json); }
                    }
                };
                if query.trim().is_empty() && !favorites.is_empty() {
                    caption(ui, "Favorites");
                    for (action, label, _) in crate::commands::all_actions() {
                        if favorites.contains(&action) {
                            ui.horizontal(|ui| {
                                if ui.small_button("★").on_hover_text("Unpin action").clicked() {
                                    favorites.retain(|a| *a != action);
                                    save_favorites(&favorites);
                                }
                                if ui.add_enabled(self.action_enabled(action), egui::Button::new(label)).clicked() {
                                    self.run_action(action);
                                    ui.close();
                                }
                            });
                        }
                    }
                    ui.separator();
                }
                ui.ctx().data_mut(|d| d.insert_temp(favorites_id, favorites.clone()));
                if !query.trim().is_empty() {
                    let words = query.to_lowercase();
                    egui::ScrollArea::vertical().max_height(300.0).show(ui, |ui| {
                        for (action, label, _) in crate::commands::all_actions() {
                            let name = label.to_lowercase();
                            if words.split_whitespace().all(|word| name.contains(word)) {
                                ui.horizontal(|ui| {
                                    let pinned = favorites.contains(&action);
                                    if ui.small_button(if pinned { "★" } else { "☆" }).on_hover_text("Pin or unpin favorite").clicked() {
                                        if pinned { favorites.retain(|a| *a != action); }
                                        else { favorites.push(action); }
                                        save_favorites(&favorites);
                                        ui.ctx().data_mut(|d| d.insert_temp(favorites_id, favorites.clone()));
                                    }
                                    if ui.add_enabled(self.action_enabled(action), egui::Button::new(label)).clicked() {
                                        self.run_action(action);
                                        ui.ctx().data_mut(|d| d.remove::<String>(search_id));
                                        ui.close();
                                    }
                                });
                            }
                        }
                    });
                    return;
                }
                ui.set_min_width(190.0);
                let recent = ui.ctx().data(|d| d.get_temp::<Vec<Action>>(egui::Id::new("recent-quick-actions")).unwrap_or_default());
                if !recent.is_empty() {
                    caption(ui, "Recent actions");
                    for action in recent {
                        if let Some((_, label, _)) = registry.iter().find(|(a, _, _)| *a == action) {
                            if ui.add_enabled(self.action_enabled(action), egui::Button::new(*label)).clicked() {
                                self.run_action(action);
                                ui.close();
                            }
                        }
                    }
                    ui.separator();
                }
                for (heading, actions) in [
                    ("Position", &[("Center in hoop", Action::CenterInHoop), ("Fit to hoop", Action::FitToHoop), ("Fit canvas view", Action::ZoomFit)][..]),
                    ("Edit selection", &[("Duplicate", Action::Duplicate), ("Flip horizontal", Action::FlipH), ("Flip vertical", Action::FlipV), ("Rotate 90°", Action::RotateRight)][..]),
                    ("Embroidery", &[("Group thread colors", Action::GroupColors), ("Inspect design", Action::ShowIssues), ("Simulate stitching", Action::PlayPause)][..]),
                ] {
                    caption(ui, heading);
                    for &(label, action) in actions {
                        if ui.add_enabled(self.action_enabled(action), egui::Button::new(label)).clicked() {
                            self.run_action(action);
                            ui.close();
                        }
                    }
                    ui.separator();
                }
            });
            let tools = [("Fit hoop", Action::FitToHoop), ("Fit view", Action::ZoomFit),
                ("Simulate", Action::PlayPause), ("Density", Action::ToggleDensity), ("Inspect", Action::ShowIssues)];
            if compact {
                ui.menu_button("Design tools", |ui| {
                    for (label, action) in tools {
                        if ui.add_enabled(self.action_enabled(action), egui::Button::new(label)).clicked() {
                            self.run_action(action);
                            ui.close();
                        }
                    }
                });
            } else {
                for (label, action) in tools {
                    if ui.add_enabled(self.action_enabled(action), egui::Button::new(label)).clicked() {
                        self.run_action(action);
                    }
                }
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let export = ui.add_enabled(
                    !self.design.blocks.is_empty(),
                    egui::Button::new(egui::RichText::new("Export").strong()).min_size(Vec2::new(64.0, 28.0))
                );
                egui::Popup::menu(&export).show(|ui| {
                    ui.set_min_width(250.0);
                    use zigzag::checks::Level;
                    let errors = self.issues.iter().filter(|i| i.level == Level::Error).count();
                    let warnings = self.issues.iter().filter(|i| i.level == Level::Warning).count();
                    ui.label(egui::RichText::new("Export preflight").strong());
                    caption(ui, format!("{} stitches · {} color blocks · {} trims",
                        fmt_int(self.design.stitch_count()), self.design.blocks.len(), self.design.trim_count()));
                    if self.planner.pending {
                        ui.label("Stitch plan is updating. Wait before exporting.");
                    } else if errors + warnings > 0 {
                        ui.label(format!("{errors} errors · {warnings} warnings"));
                        if ui.button("Review design issues").clicked() {
                            self.run_action(Action::ShowIssues);
                            ui.close();
                        }
                    } else {
                        caption(ui, "No issues detected by the current checks.");
                    }
                    ui.separator();
                    caption(ui, "Choose your machine format");
                    for (ext, label) in zigzag::formats::MACHINE_FORMATS {
                        if ui.add_enabled(!self.planner.pending && errors == 0, egui::Button::new(label)).clicked() {
                            self.run_action(Action::Export(ext));
                            ui.close();
                        }
                    }
                    ui.separator();
                    caption(ui, "DST does not store exact thread colors.");
                });
                egui::ComboBox::from_id_salt("workspace-hoop")
                    .selected_text(crate::app::HOOPS[self.doc.settings.hoop.min(crate::app::HOOPS.len() - 1)].1)
                    .width(if compact { 100.0 } else { 150.0 })
                    .show_ui(ui, |ui| {
                        for (k, h) in crate::app::HOOPS.iter().enumerate() {
                            ui.selectable_value(&mut self.doc.settings.hoop, k, h.1);
                        }
                    }).response.on_hover_text("Select the hoop matching your machine. This does not resize your design.");
                let focus_id = egui::Id::new("studio-focus-mode");
                let focus = ui.ctx().data_mut(|d| d.get_temp::<bool>(focus_id).unwrap_or(false));
                if ui.selectable_label(focus, if focus { "Exit focus" } else { "Focus" })
                    .on_hover_text("Toggle distraction-free canvas; your panel layout is preserved").clicked() {
                    ui.ctx().data_mut(|d| d.insert_temp(focus_id, !focus));
                }
                if ui.button("Help").on_hover_text("Start guided tour").clicked() {
                    ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new("studio-tour"), 0usize));
                }
            });
        });
        self.quick_tour(ui.ctx());
    }

    fn quick_tour(&mut self, ctx: &egui::Context) {
        let id = egui::Id::new("studio-tour");
        let Some(mut step) = ctx.data(|d| d.get_temp::<usize>(id)) else { return; };
        let steps = [
            ("Welcome", "Open an embroidery file or import a picture to get started."),
            ("Choose your hoop", "Choose the hoop matching your machine from the top toolbar."),
            ("Import artwork", "Use Import artwork to trace a picture into editable embroidery shapes."),
            ("Layers and stitches", "Select an object in Layers to change its thread and stitch properties."),
            ("Fit and position", "Use Fit hoop to resize explicitly, and Fit view to zoom without resizing."),
            ("Preview and inspect", "Simulate the sewing order and use Inspect to review potential issues."),
            ("Export", "Choose Export design and select your machine format, such as DST or PES."),
        ];
        let mut open = true;
        egui::Window::new("Stitch Studio • Quick tour")
            .open(&mut open).collapsible(false).resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(360.0);
                ui.label(format!("Step {} of {}", step + 1, steps.len()));
                ui.add(egui::ProgressBar::new((step + 1) as f32 / steps.len() as f32));
                ui.heading(steps[step].0);
                ui.label(steps[step].1);
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    if ui.add_enabled(step > 0, egui::Button::new("Back")).clicked() { step -= 1; }
                    let skip = ui.button("Skip").clicked();
                    let next = ui.button(if step + 1 == steps.len() { "Finish" } else { "Next" }).clicked();
                    if skip { step = steps.len(); } else if next { step += 1; }
                });
            });
        ctx.data_mut(|d| {
            if open && step < steps.len() { d.insert_temp(id, step); }
            else { d.remove::<usize>(id); }
        });
    }

    pub fn titlebar(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        let ctx = ui.ctx().clone();
        let rect = ui.max_rect();
        // Empty toolbar space moves and zooms the window, as on macOS.
        let bg = ui.interact(
            rect,
            ui.make_persistent_id("titlebar-bg"),
            Sense::click_and_drag(),
        );
        if cfg!(target_os = "macos") {
            if bg.drag_started_by(egui::PointerButton::Primary) {
                ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
            }
            if bg.double_clicked() {
                let max = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(!max));
            }
        }
        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 10.0;
            if cfg!(target_os = "macos") {
                ui.add_space(TRAFFIC_LIGHTS);
            } else {
                self.menu_bar(ui);
                ui.add_space(4.0);
            }
            if icon_button(ui, Icon::LeftPanel, "Show or Hide Objects", false, 28.0).clicked() {
                self.run_action(Action::ToggleLeftDock);
            }
            ui.add_space(4.0);
            // The document's name, and whether it has unsaved changes.
            let name = if self.doc.name.is_empty() {
                "Untitled"
            } else {
                &self.doc.name
            };
            ui.label(egui::RichText::new(name).size(13.0).color(p.text));
            if self.modified {
                ui.label(
                    egui::RichText::new("— Edited")
                        .size(13.0)
                        .color(p.secondary),
                );
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if icon_button(ui, Icon::RightPanel, "Show or Hide Panels", false, 28.0).clicked() {
                    self.run_action(Action::ToggleRightDock);
                }
                ui.add_space(6.0);
                self.send_button(ui);
                let share = icon_button(ui, Icon::Share, "Export", false, 28.0);
                egui::Popup::menu(&share).show(|ui| {
                    ui.set_min_width(260.0);
                    caption(ui, "Export for your machine");
                    let ready = !self.planner.pending && !self.design.blocks.is_empty()
                        && !self.issues.iter().any(|i| i.level == zigzag::checks::Level::Error);
                    if self.planner.pending {
                        caption(ui, "Wait for the updated stitch plan.");
                    } else if !ready && !self.design.blocks.is_empty() {
                        if ui.button("Review export errors").clicked() {
                            self.run_action(Action::ShowIssues);
                            ui.close();
                        }
                    }
                    for (ext, label) in zigzag::formats::MACHINE_FORMATS {
                        if ui
                            .add_enabled(ready, egui::Button::new(label))
                            .clicked()
                        {
                            self.run_action(Action::Export(ext));
                        }
                    }
                    ui.separator();
                    if ui
                        .add_enabled(
                            !self.design.blocks.is_empty(),
                            egui::Button::new("Production Worksheet (HTML)…"),
                        )
                        .clicked()
                    {
                        self.run_action(Action::Export("html"));
                    }
                });
                let view = icon_button(ui, Icon::ViewOptions, "View Options", false, 28.0);
                egui::Popup::from_toggle_button_response(&view)
                    .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
                    .show(|ui| {
                        ui.set_min_width(200.0);
                        ui.checkbox(&mut self.view_tools.grid, "Grid");
                        ui.checkbox(&mut self.view_tools.points, "Needle points");
                        ui.checkbox(&mut self.show_jumps, "Jump stitches");
                        ui.horizontal(|ui| {
                            ui.color_edit_button_srgb(&mut self.doc.settings.cloth);
                            ui.label("Fabric color");
                        });
                        ui.separator();
                        if ui.button("Zoom to Fit").clicked() {
                            self.request_fit();
                        }
                    });
            });
        });
        ui.painter().hline(
            rect.x_range(),
            rect.bottom() - 0.5,
            Stroke::new(1.0, p.separator),
        );
    }

    /// The toolbar's Send: the Skitch window (connecting to the Skitch).
    fn send_button(&mut self, ui: &mut egui::Ui) {
        if icon_button(ui, Icon::Send, "Send to Skitch", self.machine.open, 28.0)
            .on_hover_text("Sew it on your Skitch")
            .clicked()
        {
            self.send_action();
        }
    }

    /// The vertical tool strip, Illustrator-style.
    pub fn tool_strip(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        ui.vertical_centered(|ui| {
            ui.spacing_mut().item_spacing.y = 4.0;
            ui.add_space(8.0);
            for (t, label, key) in TOOLS {
                // Groups: the Pen's (Pen, Add / Delete Anchor Point, Anchor
                // Point) and the shapes', each in one slot with a flyout.
                match t {
                    Tool::Pen => {
                        self.group_button(ui, crate::flyout::Group::Pen);
                        continue;
                    }
                    Tool::Shape => {
                        self.group_button(ui, crate::flyout::Group::Shape);
                        continue;
                    }
                    Tool::Brush => {
                        self.group_button(ui, crate::flyout::Group::Brush);
                        continue;
                    }
                    _ => {}
                }
                let icon = match t {
                    Tool::Select => Icon::Select,
                    Tool::Direct => Icon::Direct,
                    Tool::Hand => Icon::Hand,
                    Tool::Brush => Icon::Brush,
                    Tool::Text => Icon::Text,
                    Tool::Angle => Icon::Angle,
                    Tool::Measure => Icon::Measure,
                    _ => continue,
                };
                let tip = if t == Tool::Text {
                    format!("Type ({}): click to place text, click text to edit it, click a selected path to put text on it", key.name())
                } else {
                    format!("{label} ({})", key.name())
                };
                let r = icon_button(ui, icon, label, self.tool == t, 30.0).on_hover_text(tip);
                if r.clicked() {
                    self.set_tool(t);
                }
            }
            ui.add_space(6.0);
            let (r, _) = ui.allocate_exact_size(Vec2::new(22.0, 1.0), Sense::hover());
            ui.painter()
                .hline(r.x_range(), r.center().y, Stroke::new(1.0, p.separator));
            ui.add_space(6.0);
            if icon_button(ui, Icon::ZoomFit, "Zoom to Fit", false, 30.0).clicked() {
                self.request_fit();
            }
            // The selection's thread, like Illustrator's fill swatch: click
            // it for the color picker.
            ui.add_space(10.0);
            let color = self.sel_index().map(|i| self.doc.shapes[i].color);
            let sense = if color.is_some() {
                Sense::click()
            } else {
                Sense::hover()
            };
            let (r, resp) = ui.allocate_exact_size(Vec2::splat(24.0), sense);
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Button, color.is_some(), "Thread Color")
            });
            match color {
                Some(c) => {
                    ui.painter().rect_filled(r, 5.0, crate::canvas::color32(c));
                    ui.painter().rect_stroke(
                        r,
                        5.0,
                        Stroke::new(1.0, Color32::from_black_alpha(70)),
                        egui::StrokeKind::Inside,
                    );
                }
                None => {
                    // No selection: an empty swatch with a slash, like "None".
                    ui.painter().rect_stroke(
                        r,
                        5.0,
                        Stroke::new(1.0, p.tertiary),
                        egui::StrokeKind::Inside,
                    );
                    ui.painter().line_segment(
                        [
                            r.left_bottom() + Vec2::new(4.0, -4.0),
                            r.right_top() + Vec2::new(-4.0, 4.0),
                        ],
                        Stroke::new(1.0, p.error),
                    );
                }
            }
            let resp = resp.on_hover_text(match color {
                Some(c) => format!(
                    "Thread: {} · click to change",
                    crate::threads::nearest(self.view_tools.brand, c).1
                ),
                None => "Select objects to set their thread color".into(),
            });
            if resp.clicked() {
                self.picker = match self.picker {
                    Some(_) => None,
                    None => Some(r.right_top() + Vec2::new(10.0, -8.0)),
                };
            }
            // A floating panel rather than a popup, so the palette menus
            // inside it can open their own popups.
            if let Some(at) = self.picker {
                let ctx = ui.ctx().clone();
                let area = egui::Area::new(ui.make_persistent_id("thread-picker"))
                    .order(egui::Order::Foreground)
                    .fixed_pos(at)
                    .show(&ctx, |ui| {
                        egui::Frame::popup(ui.style())
                            .inner_margin(crate::theme::pad())
                            .show(ui, |ui| self.thread_picker(ui));
                    });
                // A click anywhere else closes it (but not one in its menus).
                let outside = ctx.input(|i| {
                    i.pointer.any_pressed()
                        && i.pointer
                            .interact_pos()
                            .is_some_and(|p| !area.response.rect.contains(p) && !r.contains(p))
                });
                if outside && !egui::Popup::is_any_open(&ctx) {
                    self.picker = None;
                }
            }
            // At the bottom, apart from the tools: the agent's panel.
            ui.with_layout(egui::Layout::bottom_up(egui::Align::Center), |ui| {
                ui.add_space(10.0);
                let on = self.agent_showing();
                let r = icon_button(ui, Icon::Sparkle, "Agent", on, 30.0).on_hover_text(format!(
                    "{} (Cmd+K){}",
                    self.agent.kind.name(),
                    if self.agent.running() {
                        " · working"
                    } else {
                        ""
                    }
                ));
                if r.clicked() {
                    self.toggle_agent();
                }
            });
        });
    }

    pub fn simulator_bar(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        let total = self.design.stitch_count();
        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            ui.label(egui::RichText::new("Stitch simulator").strong().size(13.0).color(p.text));
            ui.separator();
            if ui.add_enabled(total > 0, egui::Button::new("Restart")).clicked() {
                self.playing = false;
                self.player = Some(0);
            }
            let icon = if self.playing {
                Icon::Pause
            } else {
                Icon::Play
            };
            ui.add_enabled_ui(total > 0, |ui| {
                if icon_button(
                    ui,
                    icon,
                    if self.playing { "Pause" } else { "Play" },
                    false,
                    22.0,
                )
                .on_hover_text("Play the stitch-out (Space)")
                .clicked()
                {
                    self.toggle_play();
                }
            });
            let mut pos = self.player.unwrap_or(total).min(total);
            let mut boundaries = vec![0usize];
            for block in &self.design.blocks {
                let count: usize = block.runs.iter().map(|r| r.pts.len()).sum();
                boundaries.push(boundaries.last().copied().unwrap_or(0).saturating_add(count).min(total));
            }
            if ui.add_enabled(pos > 0, egui::Button::new("◀ Color"))
                .on_hover_text("Jump to the previous color block boundary").clicked() {
                pos = boundaries.iter().copied().rev().find(|&b| b < pos).unwrap_or(0);
                self.playing = false;
                self.player = Some(pos);
            }
            if ui.add_enabled(pos < total, egui::Button::new("Color ▶"))
                .on_hover_text("Jump to the next color block boundary").clicked() {
                pos = boundaries.iter().copied().find(|&b| b > pos).unwrap_or(total);
                self.playing = false;
                self.player = if pos >= total { None } else { Some(pos) };
            }
            ui.spacing_mut().slider_width = (ui.available_width() * 0.23).clamp(64.0, 280.0);
            let slider = ui
                .add_enabled(
                    total > 0,
                    egui::Slider::new(&mut pos, 0..=total.max(1)).show_value(false),
                )
                .on_hover_text("Scrub through the sewing order");
            slider.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Slider, total > 0, "Stitch position")
            });
            if slider.changed() {
                self.playing = false;
                self.player = if pos >= total { None } else { Some(pos) };
            }
            ui.label(
                egui::RichText::new(format!("{} / {} · {:.0}%", fmt_int(pos.min(total)), fmt_int(total), 100.0 * pos as f64 / total.max(1) as f64))
                    .size(11.0)
                    .color(p.secondary)
                    .monospace(),
            );
            egui::ComboBox::from_id_salt("speed")
                .selected_text(
                    egui::RichText::new(format!("{}×", (self.speed / 400.0).max(0.25))).size(11.0),
                )
                .width(52.0)
                .show_ui(ui, |ui| {
                    for (v, l) in [
                        (100.0, "0.25×"),
                        (200.0, "0.5×"),
                        (400.0, "1×"),
                        (800.0, "2×"),
                        (1600.0, "4×"),
                        (3200.0, "8×"),
                        (6400.0, "16×"),
                    ] {
                        ui.selectable_value(&mut self.speed, v, l);
                    }
                })
                .response
                .on_hover_text("Playback speed");
            ui.add_space(8.0);
            use crate::canvas::StitchView;
            crate::theme::segmented(
                ui,
                "stitch-view",
                &mut self.view_tools.stitch_view,
                &[
                    (StitchView::Thread, "Thread"),
                    (StitchView::Lines, "Stitch Lines"),
                ],
            );
            if ui.add_enabled(total > 0, egui::Button::new("End")).clicked() {
                self.playing = false;
                self.player = None;
            }
        });
    }

    pub fn status_bar(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        let total = self.design.stitch_count();
        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            let b = self.design_bounds();
            let stats = format!(
                "{} · {} color blocks · {} trims · ~{:.0} min",
                crate::units::fmt_size(b.width(), b.height()),
                self.design.blocks.len(),
                self.design.trim_count(),
                (total as f64 / SPM).ceil()
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                self.issues_button(ui);
                self.machine_chip(ui);
                self.mcp_chip(ui);
                ui.add_space(4.0);
                self.units_picker(ui);
                if self.planner.pending {
                    // A big design re-planning on the worker: the stitches
                    // shown are the last plan's until it's done.
                    ui.label(
                        egui::RichText::new("Updating stitches…")
                            .size(11.0)
                            .color(p.secondary),
                    );
                    ui.add(egui::Spinner::new().size(10.0));
                }
                ui.label(egui::RichText::new(stats).size(11.0).color(p.secondary))
                    .on_hover_text(format!(
                        "Estimate at {SPM} stitches/min. Planned in {:.1} ms.",
                        self.plan_ms
                    ));
                ui.add_space(12.0);
                self.status_message(ui);
            });
        });
    }

    /// The unit lengths are shown in (also View › Units).
    fn units_picker(&mut self, ui: &mut egui::Ui) {
        let mut u = self.dock.units;
        egui::ComboBox::from_id_salt("units")
            .selected_text(egui::RichText::new(u.suffix()).size(11.0))
            .width(44.0)
            .show_ui(ui, |ui| {
                for v in crate::units::Unit::ALL {
                    ui.selectable_value(&mut u, v, format!("{} ({})", v.label(), v.suffix()));
                }
            })
            .response
            .on_hover_text("Units for sizes, positions, the grid and measuring");
        if u != self.dock.units {
            self.set_units(u);
        }
    }

    /// The design's issues at the right of the status bar: a warning sign
    /// and how many (colored by the worst), opening the list above it.
    fn issues_button(&mut self, ui: &mut egui::Ui) {
        use zigzag::checks::Level;
        let p = pal_ui(ui);
        let n = self.issues.len();
        let worst = self.issues.iter().map(|i| match i.level {
            Level::Error => 2,
            Level::Warning => 1,
            Level::Info => 0,
        });
        let (color, icon) = match worst.max() {
            Some(2) => (p.error, Icon::Warning),
            Some(1) => (p.warning, Icon::Warning),
            Some(_) => (p.secondary, Icon::Info),
            None => (p.tertiary, Icon::Check),
        };
        let text = if n == 0 { String::new() } else { n.to_string() };
        let galley = ui
            .painter()
            .layout_no_wrap(text, egui::FontId::proportional(11.5), color);
        let w = 26.0 + if n == 0 { 0.0 } else { galley.size().x + 4.0 };
        let (r, resp) = ui.allocate_exact_size(Vec2::new(w, 22.0), egui::Sense::click());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, "Issues"));
        let popup_id = egui::Id::unique("issues-popover");
        let open = egui::Popup::is_id_open(ui.ctx(), popup_id);
        if resp.hovered() || open {
            ui.painter().rect_filled(r, 5.0, p.hover);
        }
        crate::icons::paint(
            ui.painter(),
            Rect::from_center_size(Pos2::new(r.left() + 13.0, r.center().y), Vec2::splat(13.0)),
            icon,
            color,
        );
        if n > 0 {
            ui.painter().galley(
                Pos2::new(r.left() + 24.0, r.center().y - galley.size().y / 2.0),
                galley,
                color,
            );
        }
        let resp = resp.on_hover_text(match n {
            0 => "No problems found".to_string(),
            1 => "1 issue".to_string(),
            n => format!("{n} issues"),
        });
        if std::mem::take(&mut self.open_issues) && !open {
            egui::Popup::open_id(ui.ctx(), popup_id);
        }
        egui::Popup::from_toggle_button_response(&resp)
            .id(popup_id)
            .align(egui::RectAlign::TOP_END)
            .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
            .width(320.0)
            .show(|ui| {
                ui.set_width(320.0);
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Issues").strong().size(13.0));
                    if n > 0 {
                        ui.label(
                            egui::RichText::new(n.to_string())
                                .size(12.0)
                                .color(p.secondary),
                        );
                    }
                });
                ui.add_space(4.0);
                self.issues_body(ui);
            });
    }

    fn status_message(&mut self, ui: &mut egui::Ui) {
        let p = pal_ui(ui);
        let w = ui.available_width();
        ui.add_sized(
            [w, 18.0],
            egui::Label::new(
                egui::RichText::new(&self.status)
                    .size(11.0)
                    .color(p.secondary),
            )
            .truncate()
            .halign(egui::Align::LEFT),
        );
    }

    /// A floating HUD capsule on the canvas (tool hints), Mac-style.
    pub fn hud(&self, painter: &egui::Painter, canvas: Rect, msg: &str) {
        let p = crate::theme::pal(painter.ctx());
        let galley = painter.layout(
            msg.into(),
            egui::FontId::proportional(12.0),
            Color32::WHITE,
            canvas.width() - 120.0,
        );
        let size = galley.size() + Vec2::new(28.0, 12.0);
        let pos = Pos2::new(
            canvas.center().x - size.x / 2.0,
            canvas.bottom() - self.hud_lift - size.y - 18.0,
        );
        let bg = Rect::from_min_size(pos, size);
        painter.rect_filled(bg, size.y.min(30.0) / 2.0, p.hud);
        painter.galley(bg.min + Vec2::new(14.0, 6.0), galley, Color32::WHITE);
    }
}
