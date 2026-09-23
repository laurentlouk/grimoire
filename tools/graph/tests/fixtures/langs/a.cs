using Acme.Util;
namespace Acme.Geo {
  public interface IShape { double Area(); }
  public class Circle : Base, IShape {
    public double Area() { return Helper.Help(r); }
    public static void Run() { var c = new Circle(); c.Area(); Log("x"); }
  }
  enum Color { Red }
}
