package fixtures;

@Audit(value = "bean")
public class Bean {
  @Audit(value = "secret")
  private String secret = "initial";
  private String name = "";
  private boolean ready;

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public boolean isReady() {
    return ready;
  }

  public void setReady(boolean ready) {
    this.ready = ready;
  }

  public String getURL() {
    return "https://example.invalid";
  }
}
