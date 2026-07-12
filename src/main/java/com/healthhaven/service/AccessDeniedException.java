package com.healthhaven.service;

/** Thrown when an authenticated user attempts something their role does not permit. */
public class AccessDeniedException extends RuntimeException {

    public AccessDeniedException(String message) {
        super(message);
    }
}
