package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/** A clinical department. Doctor counts and availability are derived from staff and admissions, not typed in. */
public final class Department {

    private final long id;
    private final String name;
    private final String head;
    private final String location;
    private final String specialization;
    private final String contactNo;

    public Department(long id, String name, String head, String location, String specialization, String contactNo) {
        this.id = id;
        this.name = Validate.notBlank(name, "department name");
        this.head = Validate.name(head, "department head");
        this.location = Validate.notBlank(location, "location");
        this.specialization = Validate.notBlank(specialization, "specialization");
        this.contactNo = Validate.phone(contactNo);
    }

    public long id() {
        return id;
    }

    public String name() {
        return name;
    }

    public String head() {
        return head;
    }

    public String location() {
        return location;
    }

    public String specialization() {
        return specialization;
    }

    public String contactNo() {
        return contactNo;
    }

    @Override
    public String toString() {
        return name;
    }
}
