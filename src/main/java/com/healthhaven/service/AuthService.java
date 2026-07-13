package com.healthhaven.service;

import com.healthhaven.domain.Permission;
import com.healthhaven.domain.Role;
import com.healthhaven.domain.User;
import com.healthhaven.repository.UserRepository;

import java.util.Optional;

/**
 * Authenticates users and gates permissions.
 *
 * <p>Login here is: look the account up by username with a parameterised query,
 * fetch its bcrypt hash, and verify. There is no code path in which the password
 * the user typed becomes part of a SQL string, so the injection that defeated
 * the classic login-screen injection has nowhere to happen.
 */
public final class AuthService {

    private final UserRepository users;
    private final PasswordHasher hasher;

    public AuthService(UserRepository users, PasswordHasher hasher) {
        this.users = users;
        this.hasher = hasher;
    }

    /** Returns the signed-in user, or empty if the credentials do not match an active account. */
    public Optional<User> authenticate(String username, char[] password) {
        if (username == null || username.isBlank() || password == null) {
            return Optional.empty();
        }
        String normalised = username.trim().toLowerCase();
        Optional<String> hash = users.findActiveHash(normalised);
        // Verify even when the account is missing, against a throwaway hash, so
        // that a wrong username and a wrong password take the same time to fail
        // and cannot be told apart by a stopwatch.
        boolean ok = hasher.verify(password, hash.orElse(DUMMY_HASH));
        if (!ok || hash.isEmpty()) {
            return Optional.empty();
        }
        return users.findByUsername(normalised);
    }

    /** Creates an account, hashing the password before it reaches the repository. */
    public User register(String username, char[] password, String fullName, Role role) {
        String hash = hasher.hash(password);
        return users.insert(username, hash, fullName, role);
    }

    public void require(User user, Permission permission) {
        if (user == null || !user.can(permission)) {
            throw new AccessDeniedException(
                    (user == null ? "anonymous" : user.username()) + " may not " + permission);
        }
    }

    // A valid bcrypt hash of a random value; never matches a real password.
    private static final String DUMMY_HASH =
            "$2a$12$C6UzMDM.H6dfI/f/IKcEeO3jN0e6JZ9mQ9lVv3Wg8h1oP2sT4uVy";
}
