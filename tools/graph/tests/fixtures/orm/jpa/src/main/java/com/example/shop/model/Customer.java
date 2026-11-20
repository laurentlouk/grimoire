package com.example.shop.model;

import jakarta.persistence.*;
import java.util.List;

@Entity
public class Customer extends Auditable {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 200)
    private String email;

    private String displayName;

    @OneToMany(mappedBy = "customer")
    private List<PurchaseOrder> orders;

    @Transient
    private String sessionNote;
}
