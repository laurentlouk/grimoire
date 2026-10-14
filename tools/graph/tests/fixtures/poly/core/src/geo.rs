use crate::util::square;

pub trait Shape {
    fn area(&self) -> f64;
}

pub struct Circle {
    r: f64,
}

impl Circle {
    pub fn new(r: f64) -> Self {
        Circle { r }
    }
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        3.14 * square(self.r)
    }
}

pub struct Registry {
    items: Vec<f64>,
}

impl Registry {
    pub fn new() -> Self {
        Registry { items: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn refresh_all(&self) -> usize {
        self.items.iter().count()
    }

    pub fn version(&self) -> u32 {
        1
    }
}
