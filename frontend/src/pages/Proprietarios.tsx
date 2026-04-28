import EntityDataPage from '@/components/EntityDataPage'

const DEFAULT_FIELDS = [
  'data.reference',
  'data.status',
  'data.ad_type',
  'data.price',
  'data.contact.name',
  'data.asset.address',
  'data.user.name',
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
