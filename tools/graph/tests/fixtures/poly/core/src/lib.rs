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

use crate::geo::Registry;

// A Vec's len() is the standard library's, not Registry::len: only a typed receiver links.
pub fn registry_size() -> usize {
    let r = Registry::new();
    r.len()
}

pub fn name_count() -> usize {
    let names = util::names();
    names.len()
}

// A method name the standard library does not use still resolves on an untyped receiver.
pub fn refresh() -> usize {
    let found = util::lookup();
    found.refresh_all()
}

// A chain that starts at a type or crate the repository does not define stays in that dependency.
pub fn clock_version() -> u32 {
    Clock::now().version()
}

pub fn crate_version() -> u32 {
    semver::parse("1.0").version()
}

pub fn local_version() -> u32 {
    util::lookup().version()
}
