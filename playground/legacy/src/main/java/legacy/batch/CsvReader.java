package legacy.batch;

import java.io.IOException;
import java.io.PushbackReader;
import java.io.Reader;
import java.util.ArrayList;
import java.util.List;

public final class CsvReader {
    private CsvReader() {}

    public static List<String[]> readAll(Reader input) throws IOException {
        PushbackReader reader = new PushbackReader(input, 1);
        List<String[]> rows = new ArrayList<String[]>();
        List<String> row = new ArrayList<String>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        boolean afterQuote = false;
        boolean fieldStarted = false;
        boolean recordStarted = false;
        int value;
        while ((value = reader.read()) != -1) {
            char ch = (char) value;
            if (quoted) {
                if (ch == '"') {
                    int next = reader.read();
                    if (next == '"') {
                        field.append('"');
                    } else {
                        quoted = false;
                        afterQuote = true;
                        if (next != -1) reader.unread(next);
                    }
                } else {
                    field.append(ch);
                }
                recordStarted = true;
            } else if (afterQuote) {
                if (ch == ',') {
                    row.add(field.toString());
                    field.setLength(0);
                    fieldStarted = false;
                    afterQuote = false;
                    recordStarted = true;
                } else if (ch == '\n' || ch == '\r') {
                    finishLine(ch, reader);
                    row.add(field.toString());
                    rows.add(row.toArray(new String[0]));
                    row = new ArrayList<String>();
                    field.setLength(0);
                    fieldStarted = false;
                    afterQuote = false;
                    recordStarted = false;
                } else {
                    throw new IOException("Unexpected character after closing quote: " + ch);
                }
            } else if (ch == '"') {
                if (fieldStarted || field.length() != 0) throw new IOException("Quote inside unquoted CSV field");
                quoted = true;
                fieldStarted = true;
                recordStarted = true;
            } else if (ch == ',') {
                row.add(field.toString());
                field.setLength(0);
                fieldStarted = false;
                recordStarted = true;
            } else if (ch == '\n' || ch == '\r') {
                finishLine(ch, reader);
                row.add(field.toString());
                rows.add(row.toArray(new String[0]));
                row = new ArrayList<String>();
                field.setLength(0);
                fieldStarted = false;
                recordStarted = false;
            } else {
                field.append(ch);
                fieldStarted = true;
                recordStarted = true;
            }
        }
        if (quoted) throw new IOException("Unterminated quoted CSV field");
        if (recordStarted || afterQuote || !row.isEmpty() || field.length() != 0) {
            row.add(field.toString());
            rows.add(row.toArray(new String[0]));
        }
        return rows;
    }

    private static void finishLine(char ch, PushbackReader reader) throws IOException {
        if (ch == '\r') {
            int next = reader.read();
            if (next != '\n') throw new IOException("Expected LF after CR in CSV input");
        }
    }

    public static String writeRow(String[] cells) {
        StringBuilder output = new StringBuilder();
        for (int index = 0; index < cells.length; index++) {
            if (index > 0) output.append(',');
            String cell = cells[index] == null ? "" : cells[index];
            boolean quote = cell.indexOf(',') >= 0 || cell.indexOf('"') >= 0
                || cell.indexOf('\r') >= 0 || cell.indexOf('\n') >= 0;
            if (quote) output.append('"');
            for (int position = 0; position < cell.length(); position++) {
                char ch = cell.charAt(position);
                if (ch == '"') output.append("\"\"");
                else output.append(ch);
            }
            if (quote) output.append('"');
        }
        return output.append("\r\n").toString();
    }
}
