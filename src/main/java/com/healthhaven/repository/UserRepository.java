package com.healthhaven.repository;

import com.healthhaven.domain.Role;
import com.healthhaven.domain.User;

import java.util.List;
import java.util.Optional;

public interface UserRepository {

    /** Creates a user. The hash is supplied already computed; plain passwords never reach a repository. */
    User insert(String username, String passwordHash, String fullName, Role role);

    Optional<User> findByUsername(String username);

    /** The stored bcrypt hash for a username, if the account exists and is active. */
    Optional<String> findActiveHash(String username);

    List<User> findAll();

    long count();
}
