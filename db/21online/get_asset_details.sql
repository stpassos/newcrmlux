-- ============================================================
-- Vista unificada de um imóvel — todos os dados relacionados
-- Uso: substitua :asset_id pelo UUID do imóvel
-- ============================================================

SELECT
  -- ─── Imóvel base ────────────────────────────────────────
  a.id                          AS asset_id,
  a.reference,
  a.address,
  a.asset_type,
  a.sub_asset_type,
  a.ad_type,
  a.price,
  a.gross_area,
  a.useful_area,
  a.terrain_area,
  a.number_of_rooms,
  a.image_url,
  a.video_url,
  a.virtual_tour_link,
  a.archived,
  a.comments_count,
  a.tasks_count,
  a.visits_count,
  a.proposals_count,
  a.created_at                  AS asset_created_at,

  -- ─── Workspace / Agência ────────────────────────────────
  w.id                          AS workspace_id,
  w.name                        AS workspace_name,

  -- ─── Consultor responsável ──────────────────────────────
  ag.id                         AS agent_id,
  ag.name                       AS agent_name,
  ag.email                      AS agent_email,
  ag.phone                      AS agent_phone,
  ag.image_url                  AS agent_image_url,
  ag.role                       AS agent_role,

  -- ─── Contrato ativo ─────────────────────────────────────
  ac.id                         AS contract_id,
  ac.status                     AS contract_status,
  ac.commission_type,
  ac.commission_percentage,
  ac.commission_value,
  ac.commission_value_contract,
  ac.commission_value_sign,
  ac.price                      AS contract_price,

  -- ─── Detalhe técnico ────────────────────────────────────
  ad.lat,
  ad.lng,
  ad.postal_code,
  ad.country,
  ad.ad_1                       AS district,
  ad.ad_2                       AS municipality,
  ad.ad_3                       AS parish,
  ad.zones,
  ad.condition,
  ad.energy_efficiency,
  ad.building_year,
  ad.floor_number,
  ad.number_of_floors,
  ad.number_of_divisions,
  ad.number_of_wcs,
  ad.number_of_parking_spots,
  ad.rent_price,
  ad.trespass_price,
  ad.condo_value,
  ad.fiscal_value,
  ad.impic_purpose,
  ad.current_occupation,
  ad.gallery,
  ad.characteristics,
  ad.documents_raw,
  ad.registry,
  ad.pipeline_owner,

  -- ─── Info pública (engine.century21.pt) ─────────────────
  ei.title                      AS engine_title,
  ei.description                AS engine_description,
  ei.images                     AS engine_images,
  ei.zones                      AS engine_zones,

  -- ─── Proprietário / Owner ────────────────────────────────
  ow.id                         AS owner_id,
  ow.status                     AS owner_status,
  ow.reference                  AS owner_reference,
  ow.archived                   AS owner_archived,
  oc.id                         AS owner_contact_id,
  oc.name                       AS owner_contact_name,
  oc.email                      AS owner_contact_email,
  oc.phone                      AS owner_contact_phone,

  -- ─── Transações abertas (agregado) ──────────────────────
  (
    SELECT json_agg(json_build_object(
      'id',         t.id,
      'reference',  t.reference,
      'status',     t.status,
      'price',      t.price,
      'ad_type',    t.ad_type,
      'buyer_name', t.buyer_name,
      'owner_rep',  t.owner_rep_name,
      'buyer_rep',  t.buyer_rep_name,
      'created_at', t.created_at
    ))
    FROM c21_transactions t
    WHERE t.asset_id = a.id
      AND t.archived = false
  )                             AS transactions,

  -- ─── Visitas (agregado) ──────────────────────────────────
  (
    SELECT json_agg(json_build_object(
      'id',         v.id,
      'status',     v.status,
      'visit_date', v.visit_date,
      'buyer_name', v.buyer_name,
      'buyer_rep',  v.buyer_rep_name,
      'notes',      v.notes
    ) ORDER BY v.visit_date DESC)
    FROM c21_visits v
    WHERE v.asset_id = a.id
  )                             AS visits,

  -- ─── Propostas (agregado) ────────────────────────────────
  (
    SELECT json_agg(json_build_object(
      'id',           p.id,
      'amount',       p.amount,
      'status',       p.status,
      'contact_name', p.contact_name,
      'date',         p.proposal_date
    ) ORDER BY p.proposal_date DESC)
    FROM c21_proposals p
    WHERE p.asset_id = a.id
  )                             AS proposals,

  -- ─── Documentos (agregado) ───────────────────────────────
  (
    SELECT json_agg(json_build_object(
      'id',         d.id,
      'file_name',  d.file_name,
      'file_type',  d.file_type,
      'label',      d.label,
      'url',        d.url,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC)
    FROM c21_documents d
    WHERE d.topic = a.id
      AND d.topic_type = 'assets'
  )                             AS documents

FROM c21_assets a
LEFT JOIN c21_workspaces        w   ON w.id  = a.workspace_id
LEFT JOIN c21_agents            ag  ON ag.id = a.agent_id
LEFT JOIN c21_asset_contracts   ac  ON ac.asset_id = a.id
LEFT JOIN c21_asset_details     ad  ON ad.asset_id = a.id
LEFT JOIN c21_asset_info_engine ei  ON ei.asset_id = a.id
LEFT JOIN c21_owners            ow  ON ow.asset_id = a.id AND ow.archived = false
LEFT JOIN c21_contacts          oc  ON oc.id = ow.contact_id

WHERE a.id = :asset_id;
-- Para PostgreSQL nativo use $1 em vez de :asset_id
-- WHERE a.id = $1;
