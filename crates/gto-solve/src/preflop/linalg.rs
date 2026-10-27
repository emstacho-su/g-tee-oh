//! Gaussian elimination with partial pivoting in f64, for the small indifference systems
//! of the push/fold refinement (R2.19, O-223). No linear-algebra crate is added (ADR 0002).

/// A pivot this small relative to its column's largest entry marks a singular system.
const SINGULAR_RELATIVE_PIVOT: f64 = 1e-12;

/// Solves `matrix x = rhs` for a square `matrix` given as rows; `None` when the system is
/// not square or is singular.
pub(super) fn solve(matrix: &[Vec<f64>], rhs: &[f64]) -> Option<Vec<f64>> {
    let size = rhs.len();
    if matrix.len() != size || matrix.iter().any(|row| row.len() != size) {
        return None;
    }
    let scale = matrix.iter().flatten().fold(0.0_f64, |most, v| most.max(v.abs()));
    let mut rows: Vec<Vec<f64>> =
        matrix.iter().zip(rhs).map(|(row, b)| [row.as_slice(), &[*b]].concat()).collect();
    for column in 0..size {
        let pivot = (column..size)
            .max_by(|a, b| rows[*a][column].abs().total_cmp(&rows[*b][column].abs()))?;
        if rows[pivot][column].abs() <= SINGULAR_RELATIVE_PIVOT * scale || scale == 0.0 {
            return None;
        }
        rows.swap(column, pivot);
        let lead = rows[column].clone();
        for row in rows.iter_mut().skip(column + 1) {
            let factor = row[column] / lead[column];
            row.iter_mut().zip(&lead).skip(column).for_each(|(v, l)| *v -= factor * l);
        }
    }
    let mut x = vec![0.0; size];
    for row in (0..size).rev() {
        let known: f64 = (row + 1..size).map(|col| rows[row][col] * x[col]).sum();
        x[row] = (rows[row][size] - known) / rows[row][row];
    }
    Some(x)
}

#[cfg(test)]
mod tests {
    use super::solve;

    #[test]
    fn r2_19_solves_a_small_system_and_refuses_a_singular_one() {
        let x = solve(&[vec![0.0, 2.0], vec![3.0, 1.0]], &[4.0, 5.0]).expect("a solution");
        assert!((x[0] - 1.0).abs() < 1e-12 && (x[1] - 2.0).abs() < 1e-12, "{x:?}");
        assert!(solve(&[vec![1.0, 2.0], vec![2.0, 4.0]], &[1.0, 2.0]).is_none());
        assert!(solve(&[vec![1.0, 2.0]], &[1.0]).is_none(), "not square");
        assert_eq!(solve(&[], &[]), Some(Vec::new()));
    }
}
