package com.healthhaven.db;

/**
 * A database call failed.
 *
 * <p>Unchecked, and deliberately never swallowed. The tempting alternative —
 * catching {@code SQLException} at each call site and calling {@code
 * e.printStackTrace()} — means the user sees nothing, the operation silently does
 * not happen, and the screen carries on as though it had. Failures here
 * propagate until something can genuinely handle them.
 */
public class DataAccessException extends RuntimeException {

    public DataAccessException(String message, Throwable cause) {
        super(message, cause);
    }

    public DataAccessException(String message) {
        super(message);
    }
}
