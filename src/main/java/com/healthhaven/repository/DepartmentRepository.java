package com.healthhaven.repository;

import com.healthhaven.domain.Department;

import java.util.List;
import java.util.Optional;

public interface DepartmentRepository {

    Department insert(Department draft);

    Optional<Department> findById(long id);

    Optional<Department> findByName(String name);

    List<Department> findAll();
}
