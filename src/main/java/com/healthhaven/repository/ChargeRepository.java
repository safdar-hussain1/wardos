package com.healthhaven.repository;

import com.healthhaven.domain.billing.ExtraCharge;

import java.util.List;

public interface ChargeRepository {

    ExtraCharge insert(ExtraCharge draft);

    List<ExtraCharge> findByAdmission(long admissionId);

    List<ExtraCharge> findAll();
}
