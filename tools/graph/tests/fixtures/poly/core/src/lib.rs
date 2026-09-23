mod geo;
pub mod util;

use crate::geo::Circle;

pub fn run() -> f64 {
    let c = Circle::new(2.0);
    util::double(c.area())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs() {
        assert!(run() > 0.0);
    }
}
