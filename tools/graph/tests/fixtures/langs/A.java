package com.acme;
import com.acme.util.Helper;
import java.util.*;
public class Circle extends Base implements Shape, Other {
  public double area() { return Helper.help(r); }
  Circle() { super(); }
  static void run() { Circle c = new Circle(); c.area(); helper(); }
}
interface Shape { double area(); }
enum Color { RED }
