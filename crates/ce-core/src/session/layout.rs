use serde::{Deserialize, Serialize};

/// Direction of a pane split
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// A node in the pane layout tree
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PaneNode {
    Leaf {
        pane_id: String,
    },
    Split {
        direction: SplitDirection,
        ratio: f64,
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}

/// A tmux-style window containing a pane tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Window {
    pub id: String,
    pub name: String,
    pub root: PaneNode,
    pub active_pane_id: String,
}

/// A session containing multiple windows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub windows: Vec<Window>,
    pub active_window_index: usize,
    pub working_directory: String,
}

impl PaneNode {
    /// Get all pane IDs in this tree
    pub fn pane_ids(&self) -> Vec<String> {
        match self {
            PaneNode::Leaf { pane_id } => vec![pane_id.clone()],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.pane_ids();
                ids.extend(second.pane_ids());
                ids
            }
        }
    }

    /// Find and remove a pane, returning the sibling node (for tree pruning)
    pub fn remove_pane(&self, target_id: &str) -> Option<PaneNode> {
        match self {
            PaneNode::Leaf { .. } => None,
            PaneNode::Split { first, second, .. } => {
                if let PaneNode::Leaf { pane_id } = first.as_ref() {
                    if pane_id == target_id {
                        return Some(*second.clone());
                    }
                }
                if let PaneNode::Leaf { pane_id } = second.as_ref() {
                    if pane_id == target_id {
                        return Some(*first.clone());
                    }
                }
                // Recurse
                if let Some(new_first) = first.remove_pane(target_id) {
                    return Some(PaneNode::Split {
                        direction: match self {
                            PaneNode::Split { direction, .. } => direction.clone(),
                            _ => unreachable!(),
                        },
                        ratio: match self {
                            PaneNode::Split { ratio, .. } => *ratio,
                            _ => unreachable!(),
                        },
                        first: Box::new(new_first),
                        second: second.clone(),
                    });
                }
                if let Some(new_second) = second.remove_pane(target_id) {
                    return Some(PaneNode::Split {
                        direction: match self {
                            PaneNode::Split { direction, .. } => direction.clone(),
                            _ => unreachable!(),
                        },
                        ratio: match self {
                            PaneNode::Split { ratio, .. } => *ratio,
                            _ => unreachable!(),
                        },
                        first: first.clone(),
                        second: Box::new(new_second),
                    });
                }
                None
            }
        }
    }
}
