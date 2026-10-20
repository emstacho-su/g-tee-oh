//! Route handlers, one module per path. Each handler carries a `#[utoipa::path]`
//! attribute, and `app` mounts it through `routes!`, so the `OpenAPI` document and the
//! router come from the same declaration (O-116).

pub mod healthz;
