package org.clinic.owner;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class OwnerControllerTests {
    @Test
    void showOwner() throws Exception {
        mockMvc.perform(get("/api/owners/{id}", 1)).andExpect(status().isOk());
    }
}
