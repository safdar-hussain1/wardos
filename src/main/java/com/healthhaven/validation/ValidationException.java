package com.healthhaven.validation;

/** Thrown when input is rejected at the boundary. Unchecked: callers should fix the input, not catch this. */
public class ValidationException extends IllegalArgumentException {

    public ValidationException(String message) {
        super(message);
    }
}
