# Changelog

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
