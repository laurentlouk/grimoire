use crate::util::{helper, Other};
use std::fs;
mod inner;
pub trait Shape { fn area(&self) -> f64; }
pub struct Circle { r: f64 }
pub enum Color { Red }
impl Shape for Circle { fn area(&self) -> f64 { helper(self.r) } }
impl Circle { pub fn new() -> Self { Circle { r: 1.0 } } }
pub fn run() { let c = Circle::new(); c.area(); fs::read("x"); println!("hi"); }
#[test] fn test_run() { run(); }
type Alias = u32;
