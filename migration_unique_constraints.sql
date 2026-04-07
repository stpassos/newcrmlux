-- Add UNIQUE constraints needed for upsert (ON CONFLICT) operations
ALTER TABLE properties
  ADD CONSTRAINT uq_properties_crm_external_id UNIQUE (crm_external_id);

ALTER TABLE lead_contacts
  ADD CONSTRAINT uq_lead_contacts_crm_lead_id UNIQUE (crm_lead_id);

-- comerciais.crm_id already has an index; add UNIQUE constraint
ALTER TABLE comerciais
  ADD CONSTRAINT uq_comerciais_crm_id UNIQUE (crm_id);
