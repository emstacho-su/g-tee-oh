//! `GET /v1/coverage` (A5 section 2, R2.13, O-28, O-146, plan C.6): what the library
//! holds for one configuration and pair.
//!
//! Mechanism: the configuration identifier and the pair are parsed strictly before anything
//! is read (`ConfigId::new`, `PositionPair::from_str`; a malformed one is 400). The preflop
//! block merges the registry scanned from `FIXTURE_LIBRARY_PATH` (`Library::solutions_for`,
//! source `fixture`, listed first) with the published `solution` rows the query role may
//! read (source `library`, ids the registry lacks). Flops, textures and the queue come from
//! the database only: each flop's texture family is `gto_model::TextureFamily::of` over
//! `Flop::from_str`, and the textures block groups the flops by family. Without
//! `QUERY_DATABASE_URL` those blocks are empty and `database` is `unconfigured`; when the
//! connection or a read fails, the registry side is still served, those blocks are empty
//! and `database` is `unavailable`, never a 500 (the failure is logged by `db`).

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Query, State};
use gto_library::ManifestKind;
use gto_model::{ConfigId, Flop, ModelError, PositionPair, TextureFamily};

use crate::api::coverage::{
    CoverageQuery, CoverageResponse, CoverageSource, DatabaseState, FlopCoverage, PreflopCoverage,
    QueueEntry, TextureCoverage,
};
use crate::api::problem::Problem;
use crate::app::AppState;
use crate::db::{DbCoverage, FlopRow, QueueRow};
use crate::error::ApiError;
use crate::library::SolutionInfo;

/// The texture family reported for a stored flop text `gto_model` cannot parse; such a
/// row is a data fault logged here, not a request the caller can fix.
pub const UNKNOWN_TEXTURE_FAMILY: &str = "unknown";

/// What the library holds for a configuration and pair: preflop availability, flops by
/// texture family and the build queue.
///
/// # Errors
///
/// `ApiError::BadRequest` (400) for a configuration identifier or a pair that does not
/// parse. A database that does not answer is reported in the body, not as an error.
#[utoipa::path(
    get,
    path = "/v1/coverage",
    tag = "coverage",
    params(CoverageQuery),
    responses(
        (status = 200, description = "The coverage", body = CoverageResponse),
        (status = 400, description = "A malformed configuration identifier or pair",
            body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn coverage(
    State(state): State<AppState>,
    Query(query): Query<CoverageQuery>,
) -> Result<Json<CoverageResponse>, ApiError> {
    let config_id = parse_config_id(&query.config_id)?;
    let pair = parse_pair(&query.pair)?;
    let registry = state.library.solutions_for(&config_id, pair);
    let (database, held) = match state.db.as_deref() {
        None => (DatabaseState::Unconfigured, DbCoverage::default()),
        Some(db) => match db.coverage(&config_id, pair).await {
            Ok(held) => (DatabaseState::Connected, held),
            Err(error) => {
                tracing::warn!(%error, "coverage answered from the registry only");
                (DatabaseState::Unavailable, DbCoverage::default())
            }
        },
    };
    let flops = flop_coverage(&held.flops);
    let textures = texture_coverage(&flops);
    Ok(Json(CoverageResponse {
        config_id: config_id.to_string(),
        pair: pair.to_string(),
        preflop: preflop_coverage(&registry, &held.preflop_ids),
        flops,
        textures,
        queue: queue_entries(&held.queue),
        database,
    }))
}

/// The configuration identifier, or a 400 that quotes a bounded piece of the text.
fn parse_config_id(text: &str) -> Result<ConfigId, ApiError> {
    ConfigId::new(text).map_err(|_| {
        let shown = ApiError::quoted(text);
        ApiError::BadRequest(format!(
            "config_id {shown} is not a configuration identifier \
             (lowercase letters, digits and underscores)"
        ))
    })
}

/// The pair, out of position first, or a 400 naming the canonical order when the seats
/// were given the other way round.
fn parse_pair(text: &str) -> Result<PositionPair, ApiError> {
    text.parse().map_err(|err| {
        let shown = ApiError::quoted(text);
        match err {
            ModelError::PairOrder { canonical, .. } => ApiError::BadRequest(format!(
                "pair {shown} names the in-position seat first; write it {canonical}"
            )),
            _ => ApiError::BadRequest(format!(
                "pair {shown} is not a position pair such as BB-BTN (out of position first)"
            )),
        }
    })
}

/// The preflop block: the registry's preflop solutions first (source `fixture`), then the
/// database's published ids the registry lacks (source `library`).
fn preflop_coverage(registry: &[SolutionInfo], database_ids: &[String]) -> PreflopCoverage {
    let mut solution_ids: Vec<String> = registry
        .iter()
        .filter(|info| info.kind == ManifestKind::Preflop)
        .map(|info| info.id.clone())
        .collect();
    let mut sources = vec![CoverageSource::Fixture; solution_ids.len()];
    for id in database_ids {
        if !solution_ids.contains(id) {
            solution_ids.push(id.clone());
            sources.push(CoverageSource::Library);
        }
    }
    PreflopCoverage { available: !solution_ids.is_empty(), solution_ids, sources }
}

/// The flops block: each stored row with the texture family of its flop.
fn flop_coverage(rows: &[FlopRow]) -> Vec<FlopCoverage> {
    rows.iter()
        .map(|row| FlopCoverage {
            flop: row.flop.clone(),
            texture_family: texture_family(&row.flop),
            scenarios: row.scenarios,
            status: row.status.clone(),
        })
        .collect()
}

/// The family name of a stored flop, or [`UNKNOWN_TEXTURE_FAMILY`] for text that does not
/// parse as three distinct cards.
fn texture_family(flop: &str) -> String {
    match flop.parse::<Flop>() {
        Ok(flop) => TextureFamily::of(flop).as_str().to_owned(),
        Err(error) => {
            tracing::warn!(flop, %error, "a scenario row holds a flop that does not parse");
            UNKNOWN_TEXTURE_FAMILY.to_owned()
        }
    }
}

/// The textures block: distinct flops and scenarios summed per family, by family name.
fn texture_coverage(flops: &[FlopCoverage]) -> Vec<TextureCoverage> {
    let mut by_family: BTreeMap<&str, (Vec<&str>, u32)> = BTreeMap::new();
    for flop in flops {
        let (seen, scenarios) = by_family.entry(flop.texture_family.as_str()).or_default();
        if !seen.contains(&flop.flop.as_str()) {
            seen.push(flop.flop.as_str());
        }
        *scenarios = scenarios.saturating_add(flop.scenarios);
    }
    by_family
        .into_iter()
        .map(|(family, (seen, scenarios))| TextureCoverage {
            family: family.to_owned(),
            flops: u32::try_from(seen.len()).unwrap_or(u32::MAX),
            scenarios,
        })
        .collect()
}

/// The queue block, in queue order.
fn queue_entries(rows: &[QueueRow]) -> Vec<QueueEntry> {
    rows.iter()
        .map(|row| QueueEntry {
            job_id: row.job_id.clone(),
            flop: row.flop.clone(),
            priority: row.priority,
            status: row.status.clone(),
            position: row.position,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use gto_library::{ManifestKind, Source};

    use super::{
        UNKNOWN_TEXTURE_FAMILY, flop_coverage, parse_config_id, parse_pair, preflop_coverage,
        texture_coverage,
    };
    use crate::api::coverage::CoverageSource;
    use crate::db::FlopRow;
    use crate::error::ApiError;
    use crate::library::SolutionInfo;

    fn info(id: &str, kind: ManifestKind) -> SolutionInfo {
        SolutionInfo {
            id: id.to_owned(),
            prefix: format!("preflop/cfg/{id}"),
            kind,
            source: Source::Reference,
            synthetic: true,
            exploitability_pct_pot: None,
        }
    }

    fn row(flop: &str, status: &str, scenarios: u32) -> FlopRow {
        FlopRow { flop: flop.to_owned(), status: status.to_owned(), scenarios }
    }

    #[test]
    fn r2_13_preflop_coverage_lists_the_registry_first_and_dedups_database_ids() {
        let registry = [info("a", ManifestKind::Preflop), info("b", ManifestKind::FlopBuild)];
        let database = ["a".to_owned(), "c".to_owned()];

        let preflop = preflop_coverage(&registry, &database);

        assert!(preflop.available);
        assert_eq!(preflop.solution_ids, ["a", "c"]);
        assert_eq!(preflop.sources, [CoverageSource::Fixture, CoverageSource::Library]);
        let none = preflop_coverage(&[info("b", ManifestKind::FlopBuild)], &[]);
        assert!(!none.available);
        assert!(none.solution_ids.is_empty() && none.sources.is_empty());
    }

    #[test]
    fn r2_13_flop_and_texture_coverage_group_distinct_flops_by_family() {
        let rows = [
            row("Ah7d2c", "published", 4),
            row("Ah7d2c", "superseded", 1),
            row("KsKd2c", "published", 3),
            row("zz", "published", 1),
        ];

        let flops = flop_coverage(&rows);
        let textures = texture_coverage(&flops);

        assert_eq!(flops[0].texture_family, "dry-ace-high");
        assert_eq!(flops[2].texture_family, "paired");
        assert_eq!(flops[3].texture_family, UNKNOWN_TEXTURE_FAMILY);
        let names: Vec<&str> = textures.iter().map(|t| t.family.as_str()).collect();
        assert_eq!(names, ["dry-ace-high", "paired", "unknown"]);
        assert_eq!((textures[0].flops, textures[0].scenarios), (1, 5));
        assert_eq!((textures[1].flops, textures[1].scenarios), (1, 3));
    }

    #[test]
    fn r2_13_coverage_query_parsing_quotes_bounded_text_and_names_the_pair_order() {
        assert_eq!(
            parse_config_id("cfg_6_online_100").map(|c| c.to_string()).ok().as_deref(),
            Some("cfg_6_online_100")
        );
        let long = "A".repeat(200);
        let error = parse_config_id(&long).expect_err("uppercase is rejected");
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.len() < 200), "{error}");

        assert_eq!(parse_pair("BB-BTN").map(|p| p.to_string()).ok().as_deref(), Some("BB-BTN"));
        let reversed = parse_pair("BTN-BB").expect_err("in position first is rejected");
        assert!(
            matches!(reversed, ApiError::BadRequest(ref m) if m.contains("BB-BTN")),
            "{reversed}"
        );
        let garbage = parse_pair("XX-YY").expect_err("unknown seats");
        assert!(matches!(garbage, ApiError::BadRequest(_)), "{garbage}");
    }
}
