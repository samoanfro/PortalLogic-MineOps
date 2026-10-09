#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'production-seed.json'), 'utf8'));
const q = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const siteConfig = JSON.stringify({ mineName: seed.site.name, mshaId: seed.site.mshaId, operator: seed.site.operator });
const lines = [];
lines.push(`INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (${q(seed.organization.id)}, ${q(seed.organization.name)}, ${q(seed.organization.slug)});`);
lines.push(`INSERT OR REPLACE INTO sites (id, org_id, name, msha_id, operator, timezone, config_json) VALUES (${q(seed.site.id)}, ${q(seed.organization.id)}, ${q(seed.site.name)}, ${q(seed.site.mshaId)}, ${q(seed.site.operator)}, ${q(seed.site.timezone)}, ${q(siteConfig)});`);
for (const user of seed.users) {
  lines.push(`INSERT OR REPLACE INTO users (id, org_id, email, name, role, active) VALUES (${q(user.id)}, ${q(seed.organization.id)}, ${q(user.email)}, ${q(user.name)}, ${q(user.role)}, 1);`);
}
for (const eq of seed.equipment) {
  lines.push(`INSERT OR REPLACE INTO equipment (id, org_id, site_id, asset_tag, name, category, check_interval_days, maintenance_interval_days) VALUES (${q(eq.id)}, ${q(seed.organization.id)}, ${q(seed.site.id)}, ${q(eq.assetTag)}, ${q(eq.name)}, ${q(eq.category)}, ${Number(eq.checkIntervalDays)}, ${Number(eq.maintenanceIntervalDays)});`);
}
console.log(lines.join('\n'));
