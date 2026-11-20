package org.clinic.owner;

import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/owners")
public class OwnerController {
    private final OwnerRepository owners;

    public OwnerController(OwnerRepository owners) {
        this.owners = owners;
    }

    @GetMapping
    public List<Owner> list() {
        return owners.findAll();
    }

    @GetMapping("/{ownerId}")
    public Owner show(@PathVariable int ownerId) {
        return owners.findById(ownerId);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public Owner create(@RequestBody Owner owner) {
        return owners.save(owner);
    }

    @RequestMapping(value = "/{ownerId}/pets", method = RequestMethod.POST)
    public void addPet(@PathVariable int ownerId) {
    }
}
