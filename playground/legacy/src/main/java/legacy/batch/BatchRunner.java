package legacy.batch;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import legacy.engine.RuleRunner;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public final class BatchRunner {
    private BatchRunner() {}

    public static void main(String[] args) throws IOException {
        Path inbox = Path.of("data", "sftp", "inbox");
        Path outbox = Path.of("data", "sftp", "outbox");
        Files.createDirectories(outbox);
        try (Stream<Path> files = Files.list(inbox)) {
            for (Path file : files.filter(path -> path.getFileName().toString().endsWith(".csv"))
                    .sorted(Comparator.naturalOrder()).toList()) {
                runFile(file, outbox.resolve(file.getFileName() + ".result.csv"));
            }
        }
    }

    private static void runFile(Path input, Path output) throws IOException {
        List<String[]> rows;
        try (var reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            rows = CsvReader.readAll(reader);
        }
        if (rows.isEmpty()) throw new IOException("CSV file has no header: " + input);
        String[] header = rows.get(0);
        CsvLoader.validateHeader(header);
        try (BufferedWriter writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8)) {
            writer.write(CsvReader.writeRow(new String[] {"APP_ID", "CODES", "REFERRALS", "ERROR"}));
            for (int index = 1; index < rows.size(); index++) {
                String[] row = rows.get(index);
                String appId = row.length == 0 ? "" : row[0];
                String codes = "";
                String referrals = "";
                String error = "";
                try {
                    LoanApplication app = CsvLoader.toApplication(header, row);
                    appId = app.getAppId();
                    Decision decision = RuleRunner.run(app);
                    codes = String.join(";", decision.getCodes());
                    referrals = String.join(";", decision.getReferrals());
                } catch (Exception exception) {
                    error = exception.getClass().getSimpleName();
                }
                writer.write(CsvReader.writeRow(new String[] {appId, codes, referrals, error}));
            }
        }
    }
}
