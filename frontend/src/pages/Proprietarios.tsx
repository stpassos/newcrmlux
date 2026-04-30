import EntityDataPage from '@/components/EntityDataPage'

const DEFAULT_FIELDS = [
  'data.reference',
  'data.status',
  'data.ad_type',
  'data.price',
  'data.archived',
  // Contacto (vendedor)
  'data.contact.name',
  'data.contact.email',
  // Imóvel
  'data.asset.address',
  'data.asset.asset_type',
  'data.asset.price',
  // Agente
  'data.user.name',
  'data.user.email',
  'data.user.phone',
  // Agência
  'data.agency.name',
  // Atividade
  'data.buyers',
  'data.comments',
  'data.number_of_leads',
  'data.number_of_proposals',
  'data.number_of_visits',
  // Datas
  'data.created_at',
  'data.updated_at',
  // Meta
  'workspace_id',
  'imported_at',
]

export default function Proprietarios() {
  return (
    <EntityDataPage
      title="Proprietários"
      subtitle="Captações importadas de /api/owners enriquecidas com /api/owners/{id}"
      table="c21_owners"
      defaultFields={DEFAULT_FIELDS}
      searchPlaceholder="Pesquisar proprietários..."
    />
  )
}
