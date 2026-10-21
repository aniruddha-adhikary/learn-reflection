package modern.services;

public final class Services {
    private final CreditBureau bureau;
    public Services(CreditBureau bureau) { this.bureau = bureau; }
    public CreditBureau bureau() { return bureau; }
}
