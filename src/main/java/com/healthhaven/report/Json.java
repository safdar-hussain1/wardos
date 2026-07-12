package com.healthhaven.report;

import java.util.List;
import java.util.Map;

/**
 * A tiny JSON writer, just enough to emit the dashboard's data files.
 *
 * <p>Deliberately dependency-free: the dashboard needs a handful of arrays of
 * numbers and strings, and pulling in a full JSON library to produce them would
 * be more moving parts than the job warrants.
 */
public final class Json {

    private Json() {
    }

    @SuppressWarnings("unchecked")
    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        writeValue(out, value);
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    private static void writeValue(StringBuilder out, Object value) {
        switch (value) {
            case null -> out.append("null");
            case String s -> writeString(out, s);
            case Boolean b -> out.append(b);
            case Integer i -> out.append(i.intValue());
            case Long l -> out.append(l.longValue());
            case Double d -> out.append(formatNumber(d));
            case Number n -> out.append(n);
            case Map<?, ?> map -> writeObject(out, (Map<String, Object>) map);
            case List<?> list -> writeArray(out, list);
            default -> writeString(out, value.toString());
        }
    }

    private static void writeObject(StringBuilder out, Map<String, Object> map) {
        out.append('{');
        boolean first = true;
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            if (!first) {
                out.append(',');
            }
            first = false;
            writeString(out, entry.getKey());
            out.append(':');
            writeValue(out, entry.getValue());
        }
        out.append('}');
    }

    private static void writeArray(StringBuilder out, List<?> list) {
        out.append('[');
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) {
                out.append(',');
            }
            writeValue(out, list.get(i));
        }
        out.append(']');
    }

    private static void writeString(StringBuilder out, String s) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    private static String formatNumber(double d) {
        if (d == Math.floor(d) && !Double.isInfinite(d)) {
            return Long.toString((long) d);
        }
        return Double.toString(d);
    }
}
