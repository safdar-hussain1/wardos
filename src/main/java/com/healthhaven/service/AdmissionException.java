package com.healthhaven.service;

/** Thrown when an admission or discharge cannot proceed for a business reason. */
public class AdmissionException extends RuntimeException {

    public AdmissionException(String message) {
        super(message);
    }

    public AdmissionException(String message, Throwable cause) {
        super(message, cause);
    }
}
