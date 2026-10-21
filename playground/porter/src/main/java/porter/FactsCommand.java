package porter;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.beans.Introspector;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class FactsCommand {
    private FactsCommand() {}
    public static void run() throws Exception {
        List<Object> output = new ArrayList<Object>();
        for (Class<?> type : List.of(
                legacy.model.Applicant.class, legacy.model.LoanApplication.class, legacy.model.Decision.class,
                modern.model.Applicant.class, modern.model.LoanEvent.class, modern.model.Income.class,
                modern.model.Debts.class, modern.model.Residence.class, modern.model.LoanRequest.class,
                modern.model.Guarantor.class, modern.model.Employment.class)) {
            var record = new java.util.LinkedHashMap<String, Object>();
            record.put("class", type.getName());
            List<String> fields = new ArrayList<String>();
            for (Field field : type.getDeclaredFields()) {
                fields.add(Modifier.toString(field.getModifiers()) + " " + field.getGenericType().getTypeName()
                    + " " + field.getName());
            }
            record.put("fields", fields);
            List<String> properties = new ArrayList<String>();
            for (var descriptor : Introspector.getBeanInfo(type).getPropertyDescriptors()) {
                if ("class".equals(descriptor.getName())) continue;
                properties.add(descriptor.getName() + ":read="
                    + (descriptor.getReadMethod() == null ? "-" : descriptor.getReadMethod().getName())
                    + ",write=" + (descriptor.getWriteMethod() == null ? "-" : descriptor.getWriteMethod().getName()));
            }
            record.put("properties", properties);
            output.add(record);
        }
        new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(Path.of("out/facts.json").toFile(), output);
        output.forEach(System.out::println);
    }
}
