package com.example.shop.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity(name = "Label")
public class Tag {
    @Id
    private String code;
}
