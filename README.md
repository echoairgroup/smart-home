# Haven — Smart Home

Haven is a private, installable smart-home dashboard for a household. This first release is a static PWA with live weather for Heino and a Supabase-backed household database. It never pretends a device is connected when there is no real integration.

## Included
- Responsive Dutch dashboard with desktop sidebar and mobile navigation.
- Installable PWA and offline-cached app shell.
- Live weather for Heino through Open-Meteo.
- Supabase email/password authentication.
- Household creation, member roles and one-time invitation codes.
- Persistent room, device inventory, automation-draft and activity records.
- Row Level Security policies for household data.
- No paid API, device purchase or SmartThings subscription required for these features.

## Honest integration status
- Samsung QE43Q67DAUXXN is not directly controlled in this version. A device entry is inventory only. The official SmartThings cloud API is not used because this project must stay free. Direct local Samsung control needs a local integration/bridge online inside the home network.
- A Bluetooth speaker cannot be controlled remotely by a cloud-only website unless a connected device/local bridge exposes it.
- Automation rules are saved as drafts only. A website that is closed cannot run reliable 24/7 automations; a local always-on runtime is needed before rules can be activated.
- Energy measurements and the TV ambient-light sensor are not invented. They can be shown when a supported source is connected.

## 1. Create the free Supabase project
1. Create a project on Supabase Free.
2. Open SQL Editor and run the complete script in the supabase folder (schema.sql).
3. In Project Settings → API, copy the Project URL and anon/publishable key.
4. Put those public values in config.js as supabaseUrl and supabaseAnonKey.

The anon/publishable key is designed for browser use. Never put a service_role key, database password or any other secret in this repository. Keep Row Level Security enabled.

## 2. Run locally
Serve this folder over HTTP (not by opening index.html as a file). For example:

    python -m http.server 8080

Open http://localhost:8080. After configuring Supabase, create an account and then create the household. That first account becomes Owner. In Gezin, create an invitation code. The invited person creates their own account and pastes the code into the optional invitation field on the login/sign-up form.

## 3. Deploy
Deploy this repository as a static site on a free HTTPS hosting plan. Set the repository root as the site root; there is no build command. The service worker and PWA install prompt require HTTPS (localhost is also supported).

## Privacy and data
Household data is scoped by household_id. SQL policies ensure users can only read data for households they belong to. Owner/admin manage rooms, device inventory and automation drafts. Only the Owner may change roles. Family can read household details; Guest can read rooms and devices. Members may update only their own presence; owners/admins can correct a member status. Presence is manual and no GPS/background tracking is used. Invitation tokens are stored hashed and expire after seven days. Weather uses fixed public coordinates for Heino; no personal location is collected.

## Development
Plain HTML, CSS and modern browser JavaScript; no build tool or backend server process is required. Supabase JS is loaded from the esm.sh CDN only after configuration. Weather comes directly from Open-Meteo. The service worker caches only the app shell, not private household data.
