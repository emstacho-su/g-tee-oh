//! Route handlers, one module per path. Each handler carries a `#[utoipa::path]`
//! attribute, and `app` mounts it through `routes!`, so the `OpenAPI` document and the
//! router come from the same declaration (O-116). S16 adds every A5 section 2 route as a
//! stub answering 501 with a problem body; the lanes of plan section A replace the bodies
//! without touching the attributes.

pub mod coverage;
pub mod deal;
pub mod grade;
pub mod grade_range;
pub mod healthz;
pub mod insights;
pub mod metrics;
pub mod nodes;
pub mod sample_action;
pub mod spot_classes;
