package com.example.shop.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.Set;

@Entity
@Table(indexes = @Index(name = "ux_order_number", columnList = "orderNumber", unique = true))
public class PurchaseOrder extends Auditable {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32)
    private String orderNumber;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Customer customer;

    @Column(precision = 10, scale = 2, columnDefinition = "numeric(10,2) default 'CANARY-JPA-DEFAULT'")
    private BigDecimal total;

    private boolean gift;

    @ManyToMany
    @JoinTable(name = "order_tag", joinColumns = @JoinColumn(name = "order_id"), inverseJoinColumns = @JoinColumn(name = "tag_id"))
    private Set<Tag> tags;
}
