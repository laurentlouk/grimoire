class App {
  @Value("${app.mail.host:canary-cfg-literal-7}")
  private String mailHost;

  String home() { return System.getenv("JAVA_OPTS_X"); }
}
