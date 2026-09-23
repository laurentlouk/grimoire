package com.acme
import com.acme.util.Helper
class Circle(val r: Double) : Base(), Shape {
  override fun area(): Double = Helper.help(r)
}
interface Shape { fun area(): Double }
object Registry { fun get() = Circle(1.0) }
fun run() { val c = Circle(1.0); c.area(); helper() }
