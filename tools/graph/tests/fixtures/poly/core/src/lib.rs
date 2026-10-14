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

// Call arguments and a turbofish are not crate paths; an inline module and the crate's own package
// name start in the repository.
pub fn arg_chain() -> u32 {
    let found = util::lookup();
    found.with_mode(Mode::Fast).version()
}

pub fn make<T>() -> Registry {
    Registry::new()
}

pub fn turbo_version() -> u32 {
    make::<u8>().version()
}

mod inline {
    pub fn make_one() -> crate::geo::Registry {
        crate::geo::Registry::new()
    }
}

pub fn inline_version() -> u32 {
    inline::make_one().version()
}

pub fn package_version() -> u32 {
    geo_core::util::lookup().version()
}

pub enum Mode {
    Fast,
}

// The repository has a `builder` module, but `Output::builder()` is the dependency type's function.
pub fn output_version() -> u32 {
    Output::builder().version()
}

// A crate path is decided by its root: `util` further down is the dependency's module, not ours.
pub fn sdk_version() -> u32 {
    aws_sdk::util::Output::builder().version()
}

// A standard-library name still resolves on a qualified path and through a repository type.
pub fn path_len(r: &Registry) -> usize {
    Registry::len(r)
}

pub fn new_version() -> u32 {
    Registry::new().version()
}

// The head of a chain can be the repository's own constructor or factory.
pub struct Meters(pub f64);

impl Meters {
    pub fn double_it(&self) -> f64 {
        self.0 * 2.0
    }
}

pub fn meters() -> f64 {
    Meters(5.0).double_it()
}
