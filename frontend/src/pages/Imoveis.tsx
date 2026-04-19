import EntityDataPage from '@/components/EntityDataPage'

const DEFAULT_FIELDS = [
  'data.name',
  'data.reference',
  'data.typeDesignation',
  'data.statusDesignation',
  'data.price',
  'data.city',
  'workspace_id',
  'imported_at',
]

export default function Imoveis() {
  return (
    <EntityDataPage
      title="Imóveis"
      subtitle="Dados importados de /api/assets enriquecidos com /api/assets/{id}"
      table="c21_assets"
      defaultFields={DEFAULT_FIELDS}
      searchPlaceholder="Pesquisar imóveis..."
    />
  )
}
