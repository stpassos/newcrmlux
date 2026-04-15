# 21online.app — Esquema de Base de Dados

Integração de dados da plataforma **21online.app** (Century 21 Portugal) na base de dados PostgreSQL do NEWCRMLUX.

## Ficheiros

| Ficheiro | Descrição |
|---|---|
| `schema.sql` | DDL completo — cria todas as tabelas `c21_*` |
| `get_asset_details.sql` | Query unificada com todos os dados de um imóvel |

## Tabelas

| Tabela | Endpoint de origem | Descrição |
|---|---|---|
| `c21_workspaces` | `/api/users` (campo `agency`) | Agências / workspaces |
| `c21_agents` | `/api/users?workspaceID=` + `/api/users/{id}` | Consultores e staff |
| `c21_awards` | `/api/users/{id}/awards` | Galardões por agente |
| `c21_contacts` | `/api/contacts?userID=` | Contactos (pessoas) |
| `c21_assets` | `/api/assets?workspaceID=` | Imóveis (lista) |
| `c21_asset_contracts` | `/api/assets?workspaceID=` (campo `active_contract`) | Contratos ativos por imóvel |
| `c21_asset_details` | `/api/assets/{id}` | Ficha técnica completa do imóvel |
| `c21_asset_info_engine` | `engine.century21.pt/exporters/asset-info?reference=` | Descrições públicas multilingue |
| `c21_owners` | `/api/owners?workspaceID=` | Vendedores (pipeline) |
| `c21_buyers` | `/api/buyers?workspaceID=` | Compradores (pipeline) |
| `c21_transactions` | `/api/transactions?workspaceID=` + `/api/users/{id}/transactions` | Negócios / transações |
| `c21_referrals` | `/api/referrals?workspaceID=` | Referências entre agentes |
| `c21_visits` | `/api/users/{id}/visits` | Visitas a imóveis |
| `c21_proposals` | `/api/users/{id}/proposals` | Propostas de compra |
| `c21_documents` | `/api/documents?userID=` + `/api/documents?ownerID=` | Documentos |
| `c21_import_log` | — | Log de cada execução de importação |

## Como aplicar o esquema

### No servidor Windows (via PowerShell / psql)

```powershell
psql -h 149.102.156.188 -U newcrmlux_user -d newcrmlux -f db\21online\schema.sql
```

### Via script bat existente

Copia `schema.sql` para o servidor e executa:

```bat
psql -h localhost -U newcrmlux_user -d newcrmlux -f C:\newcrmlux-api\db\21online\schema.sql
```

## Workspace principal

| Campo | Valor |
|---|---|
| Workspace ID | `1a7fcf97-c0c5-483c-848b-9477380bf079` |
| Nome | CENTURY 21 Lux II |
| Workspace pai | `8426c13c-6568-4c79-b3ad-d6edbd91d3f4` (CENTURY 21 Lux) |

## Notas de design

- Todos os UUIDs vêm diretamente da 21online — não são gerados localmente.
- Campos JSONB (`gallery`, `characteristics`, `raw`, etc.) preservam dados aninhados sem forçar normalização prematura.
- `c21_import_log` regista cada importação para auditoria e debugging.
- A query `get_asset_details.sql` agrega numa só chamada: imóvel, consultor, contrato, detalhe técnico, info pública, owner, transações, visitas, propostas e documentos.
