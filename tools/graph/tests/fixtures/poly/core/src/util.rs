pub fn square(x: f64) -> f64 {
    x * x
}

pub fn double(x: f64) -> f64 {
    x * 2.0
}

pub fn names() -> Vec<String> {
    Vec::new()
}

pub fn lookup() -> crate::geo::Registry {
    crate::geo::Registry::new()
}
