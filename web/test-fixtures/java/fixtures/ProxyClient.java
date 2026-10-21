package fixtures;

public class ProxyClient {
  public static String call(Transformer transformer) {
    return transformer.transform("source");
  }
}
