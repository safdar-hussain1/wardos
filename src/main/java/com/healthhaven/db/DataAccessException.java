package com.healthhaven.db;

/**
 * A database call failed.
 *
 * <p>The original caught {@code SQLException} in forty-odd places and called
 * {@code e.printStackTrace()} — the user saw nothing, the operation silently did
 * not happen, and the screen carried on as though it had. Failures here
 * propagate.
 */
public class DataAccessException extends RuntimeException {

    public DataAccessException(String message, Throwable cause) {
        super(message, cause);
    }

    public DataAccessException(String message) {
        super(message);
    }
}
