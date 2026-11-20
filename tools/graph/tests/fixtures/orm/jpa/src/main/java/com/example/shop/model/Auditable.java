package com.example.shop.model;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;

@MappedSuperclass
public abstract class Auditable {
    @Column(nullable = false)
    private Instant createdAt;
}
