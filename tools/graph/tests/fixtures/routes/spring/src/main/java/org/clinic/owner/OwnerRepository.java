package org.clinic.owner;

import java.util.List;

public interface OwnerRepository {
    List<Owner> findAll();
    Owner findById(int id);
    Owner save(Owner owner);
}
