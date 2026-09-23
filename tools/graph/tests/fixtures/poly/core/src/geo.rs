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
