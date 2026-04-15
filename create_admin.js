const bcrypt = require('C:\\newcrmlux-api\\api\\node_modules\\bcryptjs');
const { Pool } = require('C:\\newcrmlux-api\\api\\node_modules\\pg');

async function main() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'newcrmlux',
    user: 'postgres',
    password: '31!dp3kcwChaiGFs',
  });

  const hash = await bcrypt.hash('4175641Ab!', 12);
  console.log('Hash:', hash);

  await pool.query(`
    INSERT INTO users (email, password_hash, user_type, is_active)
    VALUES ($1, $2, 'admin', true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = $2, user_type = 'admin', is_active = true
  `, ['admin@imodigital.pt', hash]);

  console.log('User admin@imodigital.pt created/updated successfully.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
