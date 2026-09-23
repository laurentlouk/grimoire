<?php
namespace Acme\Geo;
use Acme\Util\Helper;
interface Shape { public function area(); }
class Circle extends Base implements Shape {
  public function area() { return Helper::help($this->r); }
  public function run() { $c = new Circle(); $c->area(); helper(); }
}
function run() { run2(); }
