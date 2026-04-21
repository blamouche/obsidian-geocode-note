# Changelog

## 1.4.0

### Features

- **Inline map block** — New `geocode-map` code block that renders a Leaflet map with the note's marker (icon + color from frontmatter) wherever it's placed in the note. Displays a helpful placeholder when the note has no coordinates yet. Optional `height: <pixels>` line inside the block overrides the default height.
- **Insert map block command** — New command palette entry "Insert map block" to drop the code block at the cursor.
- **Settings** — New "Map code block" section with a slider for the default map height (120–480 px).

## 1.3.2

### Fixes

- **macOS geocoding** — Address search and reverse geocoding were silently failing on macOS because Nominatim rejects Obsidian's default Electron User-Agent. Send a descriptive `User-Agent` (plus `Accept-Language`) with every Nominatim request, as required by their usage policy.
- **IP geolocation fallback** — The single `ipapi.co` provider was unreliable (rate limits, occasional error bodies). Chain three providers (`ipapi.co`, `ipwho.is`, `get.geojs.io`) so at least one responds.
- **Error visibility** — Network failures used to surface a generic "check your connection" message. The search Notice now shows the real error (e.g. `HTTP 403`) so the user can diagnose.

## 1.3.1

### Fixes

- Rephrase the experimental setting label and descriptions so they satisfy the `obsidianmd/ui/sentence-case` rule without inline disables (required by the Obsidian community plugin review bot).

## 1.3.0

### Features

- **Obsidian Maps integration** (experimental) — New setting that injects a geolocation button into the map views rendered by the official [Obsidian Maps](https://github.com/obsidianmd/obsidian-maps) plugin. Clicking the button recenters the map on the user's current position (device GPS with IP-based fallback) and drops a blue location marker. Re-clicking updates the marker; disabling the option cleanly removes the button and marker from all open maps.
- **Settings** — New "Experimental" section exposing the Obsidian Maps integration. The toggle is auto-disabled with an explanatory message when the Obsidian Maps plugin is not installed or not enabled.

## 1.2.0

### Features

- **Bulk export** — New "Export" section in the settings panel to export every geocoded note from the vault to standard formats: GeoJSON (RFC 7946), KML 2.2, GPX 1.1, and CSV. Files are downloaded as `geocoded-notes-YYYY-MM-DD.<ext>`.
- **Settings layout** — Options and Export are now grouped under dedicated headings in the settings tab.

## 1.1.0

### Features

- **Address field** — The geocoder now writes the resolved `address` (Nominatim `display_name`) to the note's frontmatter.
- **Settings page** — New option to prefill the address search when opening the modal, using either the note title or the frontmatter `address` field.
- **Update mode** — If a note already contains geocoding data, the modal reopens with existing coordinates, icon, color and address preloaded so the user can adjust them.
- **Map preview** — Leaflet-powered preview (CartoCDN Voyager tiles) displayed once coordinates are set, with a draggable marker to fine-tune the location.
- **Reverse geocoding** — Dragging the marker triggers a Nominatim reverse lookup to refresh the `address` field automatically.

## 1.0.1

### Fixes

- Fix ESLint errors flagged by Obsidian plugin review (floating promises, unsafe `any` types, unused imports).
- Add proper TypeScript interfaces for Nominatim and IP geolocation API responses.
- Add `eslint-plugin-obsidianmd` for local linting.
- Translate all UI strings to English.

## 1.0.0

### Features

- **Geocode modal** — Add geographic metadata to any note via a ribbon icon or the command palette ("Geocode current note").
- **Three ways to set coordinates:**
  - **My current location** — Uses native geolocation on mobile, with an automatic IP-based fallback on desktop/Electron.
  - **Address search** — Geocoding powered by OpenStreetMap Nominatim (free, no API key required).
  - **Manual entry** — Directly type latitude and longitude values.
- **Marker icon picker** — 42 Lucide icons organized in 4 categories (Places, Nature, Transport, Activities), displayed as a visual grid.
- **Marker color picker** — 10 color options (red, blue, green, orange, purple, yellow, pink, teal, gray, black).
- **Frontmatter output** — Saves `coordinates`, `icon`, and `color` to the note's YAML frontmatter:
  ```yaml
  ---
  coordinates:
    - "48.85837"
    - "2.294481"
  icon: "landmark"
  color: "red"
  ---
  ```
- **Mobile-friendly UI** — Responsive design with large touch targets, works on both phone and desktop.
- **GitHub Actions release workflow** — Automatically builds and creates a draft GitHub release on tag push.
