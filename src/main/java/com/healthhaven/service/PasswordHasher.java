package com.healthhaven.service;

import at.favre.lib.crypto.bcrypt.BCrypt;

/**
 * Hashes and verifies passwords with bcrypt.
 *
 * <p>The original had none of this. The {@code login} table held passwords in
 * plain text, and the check was a string built like
 * {@code "select * from login where ID = '" + user + "' and PW = '" + pass + "'"}.
 * A password of {@code ' OR '1'='1} logged you in as the first user in the table.
 *
 * <p>bcrypt is deliberately slow (cost 12 ≈ 100 ms/hash) so that a stolen
 * database cannot be brute-forced at speed, and it salts every hash so that two
 * users with the same password get different stored values.
 */
public final class PasswordHasher {

    private static final int COST = 12;

    public String hash(char[] password) {
        if (password == null || password.length < 8) {
            throw new IllegalArgumentException("password must be at least 8 characters");
        }
        return BCrypt.withDefaults().hashToString(COST, password);
    }

    public String hash(String password) {
        return hash(password.toCharArray());
    }

    public boolean verify(char[] password, String storedHash) {
        if (password == null || storedHash == null) {
            return false;
        }
        return BCrypt.verifyer().verify(password, storedHash).verified;
    }

    public boolean verify(String password, String storedHash) {
        return verify(password.toCharArray(), storedHash);
    }
}
