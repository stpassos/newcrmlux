import EntityDataPage from '@/components/EntityDataPage'

const DEFAULT_FIELDS = [
  'data.name',
  'data.email',
  'data.phone',
  'data.mobile',
  'data.designation',
  'workspace_id',
  'imported_at',
]

export default function Utilizadores() {
  return (
    <EntityDataPage
      title="Utilizadores"
      subtitle="Dados importados de /api/users (agentes)"
      table="c21_agents"
      defaultFields={DEFAULT_FIELDS}
      searchPlaceholder="Pesquisar utilizadores..."
    />
  )
}
