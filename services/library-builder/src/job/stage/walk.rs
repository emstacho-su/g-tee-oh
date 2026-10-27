//! The job's [`LineWalk`]: it checks the line's gains against the target before anything
//! is written (02 section 3.2 step 4), writes the flop file from the root street, then
//! extracts and writes each runout's file as the solver hands it over and drops the walked
//! nodes, so a line holds at most one runout beside the solved game (A2 section 3).

use gto_library::{
    ChunkOptions, FileRef, FsStore, LibraryError, LineEntry, LineWritten, ObjectSink, RunoutSpec,
    narrow_f32, runout_file_path, write_line_files, write_tree_file,
};
use gto_model::PositionPair;
use gto_solve::postflop::{NodeStrategy, SolveReport};

use super::check_target;
use crate::error::BuilderError;
use crate::extract::{ExtractContext, extract_line, extract_runout};
use crate::solve::{LineWalk, SolvedLine};

/// What one line's walk names: where it writes and what it checks.
pub(super) struct LinePlace<'a> {
    /// The build's prefix.
    pub prefix: &'a str,
    /// The pair.
    pub pair: PositionPair,
    /// The line's text.
    pub line: &'a str,
    /// The tree hash as hexadecimal.
    pub tree_hash: &'a str,
    /// The solve's seed.
    pub seed: u64,
    /// The exploitability target, percent of the pot.
    pub target_pct_pot: f32,
}

/// The head of a walked line once its flop file is written.
struct Head {
    report: SolveReport,
    gains_pct_pot: [f64; 2],
    entry: LineEntry,
    flop_bytes: u64,
}

/// A line walked and written.
pub(super) struct WalkedLine {
    /// What was written.
    pub written: LineWritten,
    /// The solver's report.
    pub report: SolveReport,
    /// Both seats' gains, percent of the pot.
    pub gains_pct_pot: [f64; 2],
}

/// The job's walk of one line into the staging store.
pub(super) struct StageWalk<'a> {
    store: &'a mut FsStore,
    place: LinePlace<'a>,
    context: ExtractContext,
    head: Option<Head>,
    runout_files: Vec<(RunoutSpec, FileRef)>,
    runout_bytes: Vec<u64>,
}

impl<'a> StageWalk<'a> {
    /// A walk writing into `store`, extracting with `context`.
    pub(super) fn new(
        store: &'a mut FsStore,
        place: LinePlace<'a>,
        context: ExtractContext,
    ) -> StageWalk<'a> {
        StageWalk {
            store,
            place,
            context,
            head: None,
            runout_files: Vec::new(),
            runout_bytes: Vec::new(),
        }
    }

    /// The written line, once the solver returned.
    ///
    /// # Errors
    ///
    /// `BuilderError::Malformed` when the solver did not walk the root street or walked
    /// another number of runouts than `expected_runouts`.
    pub(super) fn finish(self, expected_runouts: usize) -> Result<WalkedLine, BuilderError> {
        let malformed = |reason: String| BuilderError::Malformed {
            path: format!("line {}", self.place.line),
            reason,
        };
        let Some(head) = self.head else {
            return Err(malformed("the solver returned without walking the root".to_owned()));
        };
        if self.runout_files.len() != expected_runouts {
            let walked = self.runout_files.len();
            return Err(malformed(format!(
                "the solver walked {walked} of {expected_runouts} runouts"
            )));
        }
        Ok(WalkedLine {
            written: LineWritten {
                entry: head.entry,
                runout_files: self.runout_files,
                flop_bytes: head.flop_bytes,
                runout_bytes: self.runout_bytes,
            },
            report: head.report,
            gains_pct_pot: head.gains_pct_pot,
        })
    }
}

impl LineWalk for StageWalk<'_> {
    fn root(&mut self, solved: SolvedLine) -> Result<(), BuilderError> {
        let gains = solved.gains_pct_pot;
        check_target(self.place.line, gains, self.place.target_pct_pot)?;
        self.context.accuracy_pct_pot = Some(narrow_f32(gains[0].max(gains[1])));
        let place = &self.place;
        let build = extract_line(&self.context, place.line, place.tree_hash, place.seed, &solved)?;
        let report = solved.report;
        drop(solved);
        let written = write_line_files(
            self.store,
            place.prefix,
            place.pair,
            &build,
            &ChunkOptions::default(),
        )?;
        self.head = Some(Head {
            report,
            gains_pct_pot: gains,
            entry: written.entry,
            flop_bytes: written.flop_bytes,
        });
        Ok(())
    }

    fn runout(&mut self, runout: RunoutSpec, nodes: Vec<NodeStrategy>) -> Result<(), BuilderError> {
        if self.head.is_none() {
            return Err(BuilderError::Malformed {
                path: format!("line {}", self.place.line),
                reason: format!("runout {runout} was walked before the root"),
            });
        }
        let (raw, solved) = extract_runout(&self.context, runout, &nodes)?;
        drop(nodes);
        let path = runout_file_path(&raw, self.place.line);
        let mut counting = Counting { inner: self.store, last_bytes: 0 };
        let options = ChunkOptions::default();
        let file = write_tree_file(
            &mut counting,
            self.place.prefix,
            &path,
            self.place.pair,
            &solved,
            &options,
        )?;
        self.runout_bytes.push(counting.last_bytes);
        self.runout_files.push((raw, file));
        Ok(())
    }
}

/// A sink that passes every put through and remembers the size of the last one.
struct Counting<'a> {
    inner: &'a mut FsStore,
    last_bytes: u64,
}

impl ObjectSink for Counting<'_> {
    fn put(&mut self, path: &str, bytes: &[u8]) -> Result<(), LibraryError> {
        self.inner.put(path, bytes)?;
        self.last_bytes = bytes.len() as u64;
        Ok(())
    }
}
