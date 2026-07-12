package com.healthhaven.repository;

import com.healthhaven.domain.StaffMember;

import java.util.List;
import java.util.Optional;

public interface StaffRepository {

    StaffMember insert(StaffMember draft);

    Optional<StaffMember> findByCode(String staffCode);

    List<StaffMember> findAll();

    List<StaffMember> findByDepartment(long departmentId);

    long countDoctorsInDepartment(long departmentId);
}
