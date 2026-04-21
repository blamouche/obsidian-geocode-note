import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TFile,
	requestUrl,
} from "obsidian";
import * as L from "leaflet";

// --- Icon catalog for map markers ---
const MARKER_ICONS: { category: string; icons: { name: string; label: string }[] }[] = [
	{
		category: "Places",
		icons: [
			{ name: "map-pin", label: "Pin" },
			{ name: "home", label: "Home" },
			{ name: "building-2", label: "Building" },
			{ name: "landmark", label: "Landmark" },
			{ name: "church", label: "Church" },
			{ name: "castle", label: "Castle" },
			{ name: "hotel", label: "Hotel" },
			{ name: "school", label: "School" },
			{ name: "library", label: "Library" },
			{ name: "store", label: "Store" },
			{ name: "warehouse", label: "Warehouse" },
			{ name: "factory", label: "Factory" },
			{ name: "hospital", label: "Hospital" },
		],
	},
	{
		category: "Nature",
		icons: [
			{ name: "tree-deciduous", label: "Tree" },
			{ name: "tree-pine", label: "Pine" },
			{ name: "trees", label: "Forest" },
			{ name: "mountain", label: "Mountain" },
			{ name: "mountain-snow", label: "Snowy mountain" },
			{ name: "flower-2", label: "Flower" },
			{ name: "leaf", label: "Leaf" },
			{ name: "tent", label: "Camping" },
			{ name: "waves", label: "Sea" },
		],
	},
	{
		category: "Transport",
		icons: [
			{ name: "car", label: "Car" },
			{ name: "bus", label: "Bus" },
			{ name: "train-front", label: "Train" },
			{ name: "plane", label: "Plane" },
			{ name: "ship", label: "Ship" },
			{ name: "bike", label: "Bike" },
			{ name: "fuel", label: "Gas station" },
			{ name: "anchor", label: "Harbor" },
		],
	},
	{
		category: "Activities",
		icons: [
			{ name: "coffee", label: "Coffee" },
			{ name: "utensils", label: "Restaurant" },
			{ name: "beer", label: "Bar" },
			{ name: "wine", label: "Wine" },
			{ name: "shopping-cart", label: "Shopping" },
			{ name: "dumbbell", label: "Gym" },
			{ name: "music", label: "Music" },
			{ name: "camera", label: "Photo" },
			{ name: "star", label: "Favorite" },
			{ name: "heart", label: "Heart" },
			{ name: "flag", label: "Flag" },
			{ name: "globe", label: "Globe" },
		],
	},
];

const MARKER_COLORS = [
	{ name: "red", label: "Red", hex: "#e03131" },
	{ name: "blue", label: "Blue", hex: "#1971c2" },
	{ name: "green", label: "Green", hex: "#2f9e44" },
	{ name: "orange", label: "Orange", hex: "#e8590c" },
	{ name: "purple", label: "Purple", hex: "#9c36b5" },
	{ name: "yellow", label: "Yellow", hex: "#e6a700" },
	{ name: "pink", label: "Pink", hex: "#d6336c" },
	{ name: "teal", label: "Teal", hex: "#0c8599" },
	{ name: "gray", label: "Gray", hex: "#868e96" },
	{ name: "black", label: "Black", hex: "#212529" },
];

// --- Settings ---
type PrefillSource = "none" | "title" | "address";

interface GeocodeNoteSettings {
	prefillSource: PrefillSource;
	addLocateButtonToObsidianMaps: boolean;
}

const DEFAULT_SETTINGS: GeocodeNoteSettings = {
	prefillSource: "none",
	addLocateButtonToObsidianMaps: false,
};

// --- API response types ---
interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
}

interface IpApiResult {
	latitude: number;
	longitude: number;
}

// --- Geocoding via Nominatim (OpenStreetMap) ---
async function geocodeAddress(address: string): Promise<{ lat: string; lon: string; display: string } | null> {
	const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=5`;
	const response = await requestUrl({ url });
	const results = response.json as NominatimResult[];
	if (results && results.length > 0) {
		return {
			lat: results[0].lat,
			lon: results[0].lon,
			display: results[0].display_name,
		};
	}
	return null;
}

// --- Reverse geocoding via Nominatim ---
async function reverseGeocode(lat: string, lon: string): Promise<string | null> {
	try {
		const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
		const response = await requestUrl({ url });
		const data = response.json as { display_name?: string };
		return data?.display_name ?? null;
	} catch {
		return null;
	}
}

// --- IP-based geolocation fallback (for desktop / Electron) ---
async function geolocateByIp(): Promise<{ lat: string; lon: string } | null> {
	try {
		const response = await requestUrl({ url: "https://ipapi.co/json/" });
		const data = response.json as IpApiResult;
		if (data && data.latitude && data.longitude) {
			return {
				lat: data.latitude.toString(),
				lon: data.longitude.toString(),
			};
		}
	} catch {
		// silently fail, caller handles the error
	}
	return null;
}

// --- Modal initialization options ---
interface GeocodeModalInitial {
	lat?: string;
	lon?: string;
	icon?: string;
	color?: string;
	address?: string;
	prefillQuery?: string;
	isUpdate?: boolean;
}

type GeocodeModalSubmit = (
	lat: string,
	lon: string,
	icon: string,
	color: string,
	address: string
) => void;

// --- Main Modal ---
class GeocodeModal extends Modal {
	private latitude: string;
	private longitude: string;
	private selectedIcon: string;
	private selectedColor: string;
	private address: string;
	private initialPrefillQuery: string;
	private isUpdate: boolean;
	private onSubmit: GeocodeModalSubmit;

	// DOM refs for dynamic updates
	private coordDisplay: HTMLElement | null = null;
	private iconGrid: HTMLElement | null = null;
	private colorGrid: HTMLElement | null = null;
	private submitBtn: HTMLButtonElement | null = null;
	private mapWrapper: HTMLElement | null = null;
	private mapEl: HTMLElement | null = null;
	private map: L.Map | null = null;
	private marker: L.Marker | null = null;
	private addressInput: HTMLInputElement | null = null;
	private reverseGeocodeToken = 0;

	constructor(app: App, initial: GeocodeModalInitial, onSubmit: GeocodeModalSubmit) {
		super(app);
		this.latitude = initial.lat ?? "";
		this.longitude = initial.lon ?? "";
		this.selectedIcon = initial.icon ?? "map-pin";
		this.selectedColor = initial.color ?? "red";
		this.address = initial.address ?? "";
		this.initialPrefillQuery = initial.prefillQuery ?? "";
		this.isUpdate = initial.isUpdate ?? false;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("geocode-modal");

		// --- Title ---
		contentEl.createEl("h2", {
			text: this.isUpdate ? "Update note geocoding" : "Geocode this note",
			cls: "geocode-modal-title",
		});

		// --- Section: Coordinates ---
		this.buildCoordinatesSection(contentEl);

		// --- Section: Icon picker ---
		this.buildIconSection(contentEl);

		// --- Section: Color picker ---
		this.buildColorSection(contentEl);

		// --- Submit ---
		this.buildSubmitSection(contentEl);
	}

	private buildCoordinatesSection(root: HTMLElement) {
		const section = root.createDiv({ cls: "geocode-section" });
		section.createEl("h3", { text: "Coordinates" });

		// Coordinate display
		this.coordDisplay = section.createDiv({ cls: "geocode-coord-display" });
		this.updateCoordDisplay();

		// Geolocation button
		const geoBtn = section.createDiv({ cls: "geocode-geo-btn-wrapper" });
		const btn = geoBtn.createEl("button", { cls: "geocode-btn geocode-btn-primary", text: "My current location" });
		const locateIcon = btn.createSpan({ cls: "geocode-btn-icon" });
		setIcon(locateIcon, "locate");
		btn.prepend(locateIcon);
		btn.addEventListener("click", () => void this.handleGeolocation(btn));

		// Address search
		const addressWrapper = section.createDiv({ cls: "geocode-address-wrapper" });
		const addressInput = addressWrapper.createEl("input", {
			type: "text",
			cls: "geocode-address-input",
			placeholder: "Search for an address...",
		});
		this.addressInput = addressInput;
		if (this.initialPrefillQuery) {
			addressInput.value = this.initialPrefillQuery;
		}
		const searchBtn = addressWrapper.createEl("button", { cls: "geocode-btn geocode-btn-secondary" });
		setIcon(searchBtn, "search");
		searchBtn.setAttribute("aria-label", "Search");

		const doSearch = async () => {
			const query = addressInput.value.trim();
			if (!query) {
				new Notice("Please enter an address.");
				return;
			}
			searchBtn.disabled = true;
			searchBtn.textContent = "";
			setIcon(searchBtn, "loader");
			searchBtn.addClass("geocode-spinning");
			try {
				const result = await geocodeAddress(query);
				if (result) {
					this.latitude = result.lat;
					this.longitude = result.lon;
					this.address = result.display;
					this.updateCoordDisplay();
					this.updateSubmitState();
					new Notice(`Found: ${result.display}`);
				} else {
					new Notice("No results found for this address.");
				}
			} catch {
				new Notice("Search failed. Please check your connection.");
			} finally {
				searchBtn.disabled = false;
				searchBtn.textContent = "";
				setIcon(searchBtn, "search");
				searchBtn.removeClass("geocode-spinning");
			}
		};

		searchBtn.addEventListener("click", () => void doSearch());
		addressInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void doSearch();
			}
		});

		// Manual input
		const manualWrapper = section.createDiv({ cls: "geocode-manual-wrapper" });
		const manualToggle = manualWrapper.createEl("button", {
			cls: "geocode-btn geocode-btn-link",
			text: "Enter coordinates manually",
		});
		const manualFields = manualWrapper.createDiv({ cls: "geocode-manual-fields geocode-hidden" });

		manualToggle.addEventListener("click", () => {
			manualFields.toggleClass("geocode-hidden", !manualFields.hasClass("geocode-hidden") ? true : false);
		});

		const latField = manualFields.createDiv({ cls: "geocode-field" });
		latField.createEl("label", { text: "Latitude" });
		const latInput = latField.createEl("input", {
			type: "text",
			cls: "geocode-input",
			placeholder: "48.8584",
		});
		latInput.addEventListener("input", () => {
			this.latitude = latInput.value.trim();
			this.address = "";
			this.updateCoordDisplay();
			this.updateSubmitState();
		});

		const lonField = manualFields.createDiv({ cls: "geocode-field" });
		lonField.createEl("label", { text: "Longitude" });
		const lonInput = lonField.createEl("input", {
			type: "text",
			cls: "geocode-input",
			placeholder: "2.2945",
		});
		lonInput.addEventListener("input", () => {
			this.longitude = lonInput.value.trim();
			this.address = "";
			this.updateCoordDisplay();
			this.updateSubmitState();
		});

		// Map preview
		this.mapWrapper = section.createDiv({ cls: "geocode-map-wrapper geocode-hidden" });
		this.mapEl = this.mapWrapper.createDiv({ cls: "geocode-map" });
		this.mapWrapper.createDiv({
			cls: "geocode-map-hint",
			text: "Drag the marker to fine-tune the location",
		});

		// Now that the map container exists, sync its visibility with current coords
		this.updateMap();
	}

	private async handleGeolocation(btn: HTMLButtonElement) {
		btn.disabled = true;
		btn.setText("Locating...");

		const resetBtn = () => {
			btn.disabled = false;
			btn.empty();
			const locateIcon = btn.createSpan({ cls: "geocode-btn-icon" });
			setIcon(locateIcon, "locate");
			btn.prepend(locateIcon);
			btn.appendText(" My current location");
		};

		const onSuccess = (lat: string, lon: string, approximate: boolean) => {
			this.latitude = lat;
			this.longitude = lon;
			this.address = "";
			this.updateCoordDisplay();
			this.updateSubmitState();
			resetBtn();
			const prefix = approximate ? "Approximate location" : "Location";
			new Notice(`${prefix}: ${lat}, ${lon}`);
		};

		// Try native geolocation first (works on mobile, sometimes on desktop)
		if (navigator.geolocation) {
			try {
				const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
					navigator.geolocation.getCurrentPosition(resolve, reject, {
						enableHighAccuracy: true,
						timeout: 10000,
					});
				});
				onSuccess(
					pos.coords.latitude.toString(),
					pos.coords.longitude.toString(),
					false
				);
				return;
			} catch {
				// Native geolocation failed — fall through to IP fallback
			}
		}

		// Fallback: IP-based geolocation (works on desktop/Electron)
		const ipResult = await geolocateByIp();
		if (ipResult) {
			onSuccess(ipResult.lat, ipResult.lon, true);
		} else {
			resetBtn();
			new Notice("Unable to get location. Try searching for an address instead.");
		}
	}

	private buildIconSection(root: HTMLElement) {
		const section = root.createDiv({ cls: "geocode-section" });
		section.createEl("h3", { text: "Marker icon" });

		this.iconGrid = section.createDiv({ cls: "geocode-icon-container" });

		for (const category of MARKER_ICONS) {
			const catDiv = this.iconGrid.createDiv({ cls: "geocode-icon-category" });
			catDiv.createEl("span", { text: category.category, cls: "geocode-icon-category-label" });
			const grid = catDiv.createDiv({ cls: "geocode-icon-grid" });

			for (const icon of category.icons) {
				const btn = grid.createEl("button", {
					cls: `geocode-icon-btn${icon.name === this.selectedIcon ? " geocode-selected" : ""}`,
					attr: { "aria-label": icon.label, "data-icon": icon.name },
				});
				setIcon(btn, icon.name);
				btn.addEventListener("click", () => {
					this.selectedIcon = icon.name;
					this.refreshIconSelection();
				});
			}
		}
	}

	private buildColorSection(root: HTMLElement) {
		const section = root.createDiv({ cls: "geocode-section" });
		section.createEl("h3", { text: "Marker color" });

		this.colorGrid = section.createDiv({ cls: "geocode-color-grid" });

		for (const color of MARKER_COLORS) {
			const btn = this.colorGrid.createEl("button", {
				cls: `geocode-color-btn${color.name === this.selectedColor ? " geocode-selected" : ""}`,
				attr: { "aria-label": color.label, "data-color": color.name },
			});
			btn.style.backgroundColor = color.hex;
			btn.addEventListener("click", () => {
				this.selectedColor = color.name;
				this.refreshColorSelection();
			});
		}
	}

	private buildSubmitSection(root: HTMLElement) {
		const wrapper = root.createDiv({ cls: "geocode-submit-wrapper" });
		this.submitBtn = wrapper.createEl("button", {
			cls: "geocode-btn geocode-btn-submit",
			text: "Save",
		});
		this.submitBtn.disabled = true;
		this.submitBtn.addEventListener("click", () => {
			this.close();
			this.onSubmit(
				this.latitude,
				this.longitude,
				this.selectedIcon,
				this.selectedColor,
				this.address
			);
		});
	}

	private updateCoordDisplay() {
		if (!this.coordDisplay) return;
		if (this.latitude && this.longitude) {
			this.coordDisplay.setText(`${this.latitude}, ${this.longitude}`);
			this.coordDisplay.removeClass("geocode-coord-empty");
		} else {
			this.coordDisplay.setText("No coordinates selected");
			this.coordDisplay.addClass("geocode-coord-empty");
		}
		this.updateMap();
	}

	private parseCoords(): { lat: number; lon: number } | null {
		const lat = parseFloat(this.latitude);
		const lon = parseFloat(this.longitude);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			return { lat, lon };
		}
		return null;
	}

	private updateMap() {
		if (!this.mapWrapper || !this.mapEl) return;

		const coords = this.parseCoords();
		if (!coords) {
			this.mapWrapper.addClass("geocode-hidden");
			return;
		}

		this.mapWrapper.removeClass("geocode-hidden");

		if (!this.map) {
			const markerIcon = L.divIcon({
				className: "geocode-leaflet-marker",
				iconSize: [28, 28],
				iconAnchor: [14, 28],
			});

			this.map = L.map(this.mapEl, {
				center: [coords.lat, coords.lon],
				zoom: 14,
				zoomControl: true,
				attributionControl: true,
			});

			L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
				subdomains: "abcd",
				maxZoom: 19,
				attribution: "© OpenStreetMap, © CARTO",
			}).addTo(this.map);

			this.marker = L.marker([coords.lat, coords.lon], {
				draggable: true,
				icon: markerIcon,
			}).addTo(this.map);

			this.marker.on("dragend", () => {
				if (!this.marker) return;
				const pos = this.marker.getLatLng();
				this.latitude = pos.lat.toFixed(6);
				this.longitude = pos.lng.toFixed(6);
				if (this.coordDisplay) {
					this.coordDisplay.setText(`${this.latitude}, ${this.longitude}`);
					this.coordDisplay.removeClass("geocode-coord-empty");
				}
				this.updateSubmitState();
				void this.refreshAddressFromCoords();
			});

			// Leaflet needs a size recalculation once the container is visible
			setTimeout(() => this.map?.invalidateSize(), 0);
		} else {
			this.map.setView([coords.lat, coords.lon], this.map.getZoom());
			this.marker?.setLatLng([coords.lat, coords.lon]);
			setTimeout(() => this.map?.invalidateSize(), 0);
		}
	}

	private updateSubmitState() {
		if (!this.submitBtn) return;
		this.submitBtn.disabled = !(this.latitude && this.longitude);
	}

	private async refreshAddressFromCoords() {
		const lat = this.latitude;
		const lon = this.longitude;
		if (!lat || !lon) return;
		const token = ++this.reverseGeocodeToken;
		const resolved = await reverseGeocode(lat, lon);
		// Drop the result if another request started in the meantime, or coords changed
		if (token !== this.reverseGeocodeToken) return;
		if (this.latitude !== lat || this.longitude !== lon) return;
		this.address = resolved ?? "";
		if (this.addressInput) {
			this.addressInput.value = this.address;
		}
	}

	private refreshIconSelection() {
		if (!this.iconGrid) return;
		this.iconGrid.findAll(".geocode-icon-btn").forEach((el) => {
			el.toggleClass("geocode-selected", el.getAttribute("data-icon") === this.selectedIcon);
		});
	}

	private refreshColorSelection() {
		if (!this.colorGrid) return;
		this.colorGrid.findAll(".geocode-color-btn").forEach((el) => {
			el.toggleClass("geocode-selected", el.getAttribute("data-color") === this.selectedColor);
		});
	}

	onClose() {
		if (this.map) {
			this.map.remove();
			this.map = null;
			this.marker = null;
		}
		this.contentEl.empty();
	}
}

// --- Export types & helpers ---
type ExportFormat = "geojson" | "kml" | "gpx" | "csv";

interface GeocodedNote {
	title: string;
	path: string;
	lat: number;
	lon: number;
	address: string;
	icon: string;
	color: string;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function escapeCsv(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function buildGeoJson(notes: GeocodedNote[]): string {
	const features = notes.map((n) => ({
		type: "Feature",
		geometry: {
			type: "Point",
			coordinates: [n.lon, n.lat],
		},
		properties: {
			name: n.title,
			path: n.path,
			address: n.address,
			icon: n.icon,
			color: n.color,
		},
	}));
	return JSON.stringify(
		{
			type: "FeatureCollection",
			features,
		},
		null,
		2
	);
}

function buildKml(notes: GeocodedNote[]): string {
	const placemarks = notes
		.map(
			(n) =>
				`    <Placemark>\n` +
				`      <name>${escapeXml(n.title)}</name>\n` +
				`      <description>${escapeXml(n.address)}</description>\n` +
				`      <Point><coordinates>${n.lon},${n.lat},0</coordinates></Point>\n` +
				`    </Placemark>`
		)
		.join("\n");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
		`  <Document>\n` +
		`    <name>Obsidian geocoded notes</name>\n` +
		`${placemarks}\n` +
		`  </Document>\n` +
		`</kml>\n`
	);
}

function buildGpx(notes: GeocodedNote[]): string {
	const waypoints = notes
		.map(
			(n) =>
				`  <wpt lat="${n.lat}" lon="${n.lon}">\n` +
				`    <name>${escapeXml(n.title)}</name>\n` +
				`    <desc>${escapeXml(n.address)}</desc>\n` +
				`  </wpt>`
		)
		.join("\n");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<gpx version="1.1" creator="Obsidian Geocode Note" xmlns="http://www.topografix.com/GPX/1/1">\n` +
		`${waypoints}\n` +
		`</gpx>\n`
	);
}

function buildCsv(notes: GeocodedNote[]): string {
	const header = "title,latitude,longitude,address,icon,color,path";
	const rows = notes.map((n) =>
		[n.title, n.lat, n.lon, n.address, n.icon, n.color, n.path]
			.map((v) => escapeCsv(String(v)))
			.join(",")
	);
	return [header, ...rows].join("\n") + "\n";
}

const EXPORT_FORMATS: {
	format: ExportFormat;
	label: string;
	description: string;
	extension: string;
	mime: string;
	build: (notes: GeocodedNote[]) => string;
}[] = [
	{
		format: "geojson",
		label: "GeoJSON",
		description: "RFC 7946 — compatible with Leaflet, Mapbox, QGIS, ArcGIS.",
		extension: "geojson",
		mime: "application/geo+json",
		build: buildGeoJson,
	},
	{
		format: "kml",
		label: "KML",
		description: "OGC KML 2.2 — opens in Google Earth and Google My Maps.",
		extension: "kml",
		mime: "application/vnd.google-earth.kml+xml",
		build: buildKml,
	},
	{
		format: "gpx",
		label: "GPX",
		description: "GPS Exchange 1.1 — waypoints for GPS devices and outdoor apps.",
		extension: "gpx",
		mime: "application/gpx+xml",
		build: buildGpx,
	},
	{
		format: "csv",
		label: "CSV",
		description: "Simple tabular export — opens in Excel, Numbers, Google Sheets.",
		extension: "csv",
		mime: "text/csv",
		build: buildCsv,
	},
];

function downloadBlob(content: string, filename: string, mime: string) {
	const blob = new Blob([content], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- MapLibre IControl (duck-typed) injected into obsidian-maps views ---
// We avoid bundling maplibre-gl — MapLibre's `addControl` only needs `{ onAdd, onRemove }`.
interface DuckGeoJsonSource {
	setData: (data: unknown) => unknown;
}

interface DuckMapLibreMap {
	addControl: (control: unknown, position?: string) => unknown;
	removeControl: (control: unknown) => unknown;
	flyTo?: (opts: { center: [number, number]; zoom?: number }) => unknown;
	setCenter?: (center: [number, number]) => unknown;
	getZoom?: () => number;
	isStyleLoaded?: () => boolean;
	once?: (event: string, handler: () => void) => unknown;
	getSource?: (id: string) => DuckGeoJsonSource | undefined;
	addSource?: (id: string, source: unknown) => unknown;
	addLayer?: (layer: unknown) => unknown;
	getLayer?: (id: string) => unknown;
	removeLayer?: (id: string) => unknown;
	removeSource?: (id: string) => unknown;
}

const LOCATE_SOURCE_ID = "geocode-note-locate-source";
const LOCATE_LAYER_HALO = "geocode-note-locate-halo";
const LOCATE_LAYER_DOT = "geocode-note-locate-dot";

class MapLibreLocateControl {
	private map: DuckMapLibreMap | null = null;
	private container: HTMLElement | null = null;
	private button: HTMLButtonElement | null = null;
	private busy = false;

	onAdd(map: DuckMapLibreMap): HTMLElement {
		this.map = map;
		const container = document.createElement("div");
		container.className = "maplibregl-ctrl maplibregl-ctrl-group geocode-maps-locate";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "geocode-maps-locate-btn";
		button.setAttribute("aria-label", "Find my location");
		button.title = "Find my location";
		setIcon(button, "locate-fixed");

		button.addEventListener("click", () => void this.handleClick());

		container.appendChild(button);
		this.container = container;
		this.button = button;
		return container;
	}

	onRemove(): void {
		if (this.map) {
			try {
				if (this.map.getLayer?.(LOCATE_LAYER_DOT)) this.map.removeLayer?.(LOCATE_LAYER_DOT);
				if (this.map.getLayer?.(LOCATE_LAYER_HALO)) this.map.removeLayer?.(LOCATE_LAYER_HALO);
				if (this.map.getSource?.(LOCATE_SOURCE_ID)) this.map.removeSource?.(LOCATE_SOURCE_ID);
			} catch {
				// ignore
			}
		}
		this.container?.remove();
		this.container = null;
		this.button = null;
		this.map = null;
	}

	private async handleClick() {
		if (this.busy || !this.map || !this.button) return;
		this.busy = true;
		this.button.classList.add("geocode-maps-locate-busy");

		try {
			const pos = await this.getPosition();
			if (!pos) {
				new Notice("Unable to get your location.");
				return;
			}
			const lngLat: [number, number] = [pos.lon, pos.lat];
			const currentZoom = this.map.getZoom?.() ?? 10;
			const targetZoom = Math.max(currentZoom, 13);
			if (this.map.flyTo) {
				this.map.flyTo({ center: lngLat, zoom: targetZoom });
			} else if (this.map.setCenter) {
				this.map.setCenter(lngLat);
			}
			this.placeLocationMarker(lngLat);
			const prefix = pos.approximate ? "Approximate location" : "Location";
			new Notice(`${prefix}: ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`);
		} finally {
			this.busy = false;
			this.button?.classList.remove("geocode-maps-locate-busy");
		}
	}

	private placeLocationMarker(lngLat: [number, number]) {
		const map = this.map;
		if (!map) return;
		const geojson = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: lngLat },
					properties: {},
				},
			],
		};

		const render = () => {
			try {
				const existing = map.getSource?.(LOCATE_SOURCE_ID);
				if (existing && typeof existing.setData === "function") {
					existing.setData(geojson);
					return;
				}
				map.addSource?.(LOCATE_SOURCE_ID, { type: "geojson", data: geojson });
				map.addLayer?.({
					id: LOCATE_LAYER_HALO,
					type: "circle",
					source: LOCATE_SOURCE_ID,
					paint: {
						"circle-radius": 14,
						"circle-color": "#1971c2",
						"circle-opacity": 0.2,
						"circle-stroke-width": 0,
					},
				});
				map.addLayer?.({
					id: LOCATE_LAYER_DOT,
					type: "circle",
					source: LOCATE_SOURCE_ID,
					paint: {
						"circle-radius": 7,
						"circle-color": "#1971c2",
						"circle-stroke-width": 3,
						"circle-stroke-color": "#ffffff",
					},
				});
			} catch {
				// ignore — style mismatch or map disposed
			}
		};

		if (map.isStyleLoaded?.() === false && typeof map.once === "function") {
			map.once("load", render);
		} else {
			render();
		}
	}

	private async getPosition(): Promise<{ lat: number; lon: number; approximate: boolean } | null> {
		if (navigator.geolocation) {
			try {
				const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
					navigator.geolocation.getCurrentPosition(resolve, reject, {
						enableHighAccuracy: true,
						timeout: 10000,
					});
				});
				return { lat: pos.coords.latitude, lon: pos.coords.longitude, approximate: false };
			} catch {
				// fall through to IP
			}
		}
		const ip = await geolocateByIp();
		if (ip) {
			return { lat: parseFloat(ip.lat), lon: parseFloat(ip.lon), approximate: true };
		}
		return null;
	}
}

// --- Plugin ---
export default class GeocodeNotePlugin extends Plugin {
	settings: GeocodeNoteSettings = { ...DEFAULT_SETTINGS };

	private obsidianMapsPatch: {
		registration: { factory: (controller: unknown, containerEl: HTMLElement) => unknown };
		origFactory: (controller: unknown, containerEl: HTMLElement) => unknown;
		controls: WeakMap<object, MapLibreLocateControl>;
	} | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new GeocodeSettingTab(this.app, this));

		// Ribbon icon
		this.addRibbonIcon("map-pin", "Geocode note", () => {
			this.openGeocodeModal();
		});

		// Command palette
		this.addCommand({
			id: "geocode-current-note",
			name: "Geocode current note",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					if (!checking) {
						this.openGeocodeModal();
					}
					return true;
				}
				return false;
			},
		});

		// Experimental: inject locate control into obsidian-maps plugin views
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.addLocateButtonToObsidianMaps) {
				this.applyObsidianMapsPatch();
			}
		});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				if (!this.settings.addLocateButtonToObsidianMaps) return;
				if (!this.obsidianMapsPatch) {
					this.applyObsidianMapsPatch();
				} else {
					this.attachLocateToExistingMapViews(this.obsidianMapsPatch.controls);
				}
			})
		);
	}

	onunload(): void {
		this.removeObsidianMapsPatch();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<GeocodeNoteSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openGeocodeModal() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active note.");
			return;
		}

		const initial = this.buildModalInitial(file);
		const isUpdate = initial.isUpdate === true;

		new GeocodeModal(this.app, initial, (lat, lon, icon, color, address) => {
			void this.saveFrontmatter(file, lat, lon, icon, color, address).then(() => {
				new Notice(isUpdate ? "Coordinates updated!" : "Coordinates saved!");
			});
		}).open();
	}

	private buildModalInitial(file: TFile): GeocodeModalInitial {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

		const coords = fm["coordinates"];
		const hasCoords =
			Array.isArray(coords) &&
			coords.length === 2 &&
			coords[0] != null &&
			coords[1] != null;

		const existingAddress = typeof fm["address"] === "string" ? fm["address"] : "";

		const settingsPrefill = this.resolveSettingsPrefill(file, existingAddress);

		if (hasCoords) {
			const [rawLat, rawLon] = coords as unknown[];
			return {
				lat: String(rawLat),
				lon: String(rawLon),
				icon: typeof fm["icon"] === "string" ? fm["icon"] : "map-pin",
				color: typeof fm["color"] === "string" ? fm["color"] : "red",
				address: existingAddress,
				prefillQuery: existingAddress || settingsPrefill,
				isUpdate: true,
			};
		}

		return { prefillQuery: settingsPrefill };
	}

	private resolveSettingsPrefill(file: TFile, existingAddress: string): string {
		if (this.settings.prefillSource === "title") {
			return file.basename;
		}
		if (this.settings.prefillSource === "address") {
			return existingAddress;
		}
		return "";
	}

	collectGeocodedNotes(): GeocodedNote[] {
		const notes: GeocodedNote[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter as Record<string, unknown> | undefined;
			if (!fm) continue;

			const coords = fm["coordinates"];
			if (!Array.isArray(coords) || coords.length !== 2) continue;

			const lat = parseFloat(String(coords[0]));
			const lon = parseFloat(String(coords[1]));
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

			notes.push({
				title: file.basename,
				path: file.path,
				lat,
				lon,
				address: typeof fm["address"] === "string" ? fm["address"] : "",
				icon: typeof fm["icon"] === "string" ? fm["icon"] : "map-pin",
				color: typeof fm["color"] === "string" ? fm["color"] : "red",
			});
		}
		return notes;
	}

	exportGeocodedNotes(format: ExportFormat): void {
		const spec = EXPORT_FORMATS.find((f) => f.format === format);
		if (!spec) return;

		const notes = this.collectGeocodedNotes();
		if (notes.length === 0) {
			new Notice("No geocoded notes found to export.");
			return;
		}

		const content = spec.build(notes);
		const timestamp = new Date().toISOString().slice(0, 10);
		const filename = `geocoded-notes-${timestamp}.${spec.extension}`;
		downloadBlob(content, filename, spec.mime);
		new Notice(`Exported ${notes.length} note${notes.length > 1 ? "s" : ""} to ${spec.label}.`);
	}

	// --- Experimental: obsidian-maps patching ---

	isObsidianMapsAvailable(): boolean {
		const app = this.app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } };
		return Boolean(app.plugins?.getPlugin?.("maps"));
	}

	applyObsidianMapsPatch(): void {
		if (this.obsidianMapsPatch) return;
		try {
			const reg = this.findMapBasesRegistration();
			if (!reg || typeof reg.factory !== "function") return;

			const origFactory = reg.factory.bind(reg) as (
				controller: unknown,
				containerEl: HTMLElement
			) => unknown;
			const controls = new WeakMap<object, MapLibreLocateControl>();

			reg.factory = (controller: unknown, containerEl: HTMLElement) => {
				const view = origFactory(controller, containerEl);
				this.hookViewForLocate(view, controls);
				return view;
			};

			this.obsidianMapsPatch = { registration: reg, origFactory, controls };
			this.attachLocateToExistingMapViews(controls);
		} catch {
			// Experimental hook: silently no-op if obsidian-maps internals have changed
		}
	}

	removeObsidianMapsPatch(): void {
		if (!this.obsidianMapsPatch) return;
		const { registration, origFactory, controls } = this.obsidianMapsPatch;
		try {
			registration.factory = origFactory;
		} catch {
			// ignore
		}

		const workspace = this.app.workspace as unknown as {
			iterateAllLeaves?: (cb: (leaf: { view?: unknown }) => void) => void;
		};
		workspace.iterateAllLeaves?.((leaf) => {
			this.findMapViewsIn(leaf.view).forEach((mv) => {
				const map = (mv as { map?: DuckMapLibreMap }).map;
				if (!map) return;
				const ctrl = controls.get(map);
				if (!ctrl) return;
				try {
					map.removeControl(ctrl);
				} catch {
					// ignore
				}
				controls.delete(map);
			});
		});

		this.obsidianMapsPatch = null;
	}

	private findMapBasesRegistration(): {
		factory: (controller: unknown, containerEl: HTMLElement) => unknown;
	} | null {
		const app = this.app as unknown as {
			internalPlugins?: {
				getPluginById?: (id: string) => { instance?: unknown } | undefined;
				plugins?: Record<string, { instance?: unknown } | undefined>;
			};
		};
		const bases =
			app.internalPlugins?.getPluginById?.("bases")?.instance ??
			app.internalPlugins?.plugins?.["bases"]?.instance;
		if (!bases) return null;

		const b = bases as {
			getRegistration?: (id: string) => unknown;
			getViewRegistration?: (id: string) => unknown;
			registrations?: Map<string, unknown> | Record<string, unknown>;
			viewRegistrations?: Map<string, unknown> | Record<string, unknown>;
			registeredViews?: Map<string, unknown> | Record<string, unknown>;
		};

		const lookup = (
			store: Map<string, unknown> | Record<string, unknown> | undefined
		): unknown => {
			if (!store) return undefined;
			if (store instanceof Map) return store.get("map");
			return store["map"];
		};

		const candidates: unknown[] = [
			b.getRegistration?.("map"),
			b.getViewRegistration?.("map"),
			lookup(b.registrations),
			lookup(b.viewRegistrations),
			lookup(b.registeredViews),
		];

		for (const c of candidates) {
			if (c && typeof (c as { factory?: unknown }).factory === "function") {
				return c as { factory: (controller: unknown, containerEl: HTMLElement) => unknown };
			}
		}
		return null;
	}

	private hookViewForLocate(view: unknown, controls: WeakMap<object, MapLibreLocateControl>) {
		if (!view) return;
		const v = view as {
			initializeMap?: (...args: unknown[]) => unknown;
			map?: DuckMapLibreMap;
		};
		const origInit = v.initializeMap;
		if (typeof origInit !== "function") return;

		v.initializeMap = async (...args: unknown[]) => {
			const result: unknown = await (origInit as (...a: unknown[]) => unknown).apply(v, args);
			this.tryAttachControl(v, controls);
			return result;
		};

		// Already-open view whose map is already built: attach immediately
		this.tryAttachControl(v, controls);
	}

	private tryAttachControl(
		view: { map?: DuckMapLibreMap },
		controls: WeakMap<object, MapLibreLocateControl>
	) {
		const map = view.map;
		if (!map || typeof map.addControl !== "function") return;
		if (controls.has(map)) return;
		try {
			const ctrl = new MapLibreLocateControl();
			map.addControl(ctrl, "top-right");
			controls.set(map, ctrl);
		} catch {
			// ignore — addControl signature mismatch or internal error
		}
	}

	private attachLocateToExistingMapViews(controls: WeakMap<object, MapLibreLocateControl>) {
		const workspace = this.app.workspace as unknown as {
			iterateAllLeaves?: (cb: (leaf: { view?: unknown }) => void) => void;
		};
		workspace.iterateAllLeaves?.((leaf) => {
			this.findMapViewsIn(leaf.view).forEach((mv) => this.hookViewForLocate(mv, controls));
		});
	}

	private findMapViewsIn(root: unknown): unknown[] {
		const results: unknown[] = [];
		const seen = new WeakSet<object>();
		const childKeys = [
			"_children",
			"children",
			"currentView",
			"view",
			"activeView",
			"basesView",
			"bases",
			"component",
		];
		const visit = (node: unknown, depth: number) => {
			if (!node || typeof node !== "object" || depth > 8) return;
			if (seen.has(node)) return;
			seen.add(node);
			const n = node as Record<string, unknown> & {
				constructor?: { name?: string };
				initializeMap?: unknown;
			};
			const looksLikeMapView =
				typeof n.initializeMap === "function" &&
				"map" in n &&
				"mapEl" in n;
			if (looksLikeMapView || n.constructor?.name === "MapView") {
				results.push(node);
			}
			for (const key of childKeys) {
				const value = n[key];
				if (Array.isArray(value)) {
					value.forEach((c) => visit(c, depth + 1));
				} else if (value) {
					visit(value, depth + 1);
				}
			}
		};
		visit(root, 0);
		return results;
	}

	private async saveFrontmatter(
		file: TFile,
		lat: string,
		lon: string,
		icon: string,
		color: string,
		address: string
	) {
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			frontmatter["coordinates"] = [lat, lon];
			frontmatter["icon"] = icon;
			frontmatter["color"] = color;
			if (address) {
				frontmatter["address"] = address;
			} else {
				delete frontmatter["address"];
			}
		});
	}
}

// --- Settings tab ---
class GeocodeSettingTab extends PluginSettingTab {
	plugin: GeocodeNotePlugin;

	constructor(app: App, plugin: GeocodeNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Prefill search field")
			.setDesc(
				"When opening the geocoder, prefill the address search with a value taken from the current note."
			)
			.addDropdown((dd) => {
				dd.addOption("none", "Nothing")
					.addOption("title", "Note title")
					.addOption("address", "Frontmatter \"address\" field")
					.setValue(this.plugin.settings.prefillSource)
					.onChange(async (value) => {
						this.plugin.settings.prefillSource = value as PrefillSource;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Experimental").setHeading();

		const mapsAvailable = this.plugin.isObsidianMapsAvailable();
		const experimental = new Setting(containerEl).setName(
			"Add locate button to Obsidian maps"
		);
		if (mapsAvailable) {
			experimental.setDesc(
				"Injects a geolocation button into maps rendered by the official Obsidian maps plugin. Experimental — relies on undocumented internals and may break with future updates of Obsidian maps."
			);
			experimental.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.addLocateButtonToObsidianMaps)
					.onChange(async (value) => {
						this.plugin.settings.addLocateButtonToObsidianMaps = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.applyObsidianMapsPatch();
						} else {
							this.plugin.removeObsidianMapsPatch();
						}
					});
			});
		} else {
			experimental.setDesc(
				"Requires the official Obsidian maps plugin to be installed and enabled. Not detected in this vault."
			);
			experimental.addToggle((toggle) => {
				toggle.setValue(false).setDisabled(true);
			});
		}

		new Setting(containerEl).setName("Export").setHeading();

		const count = this.plugin.collectGeocodedNotes().length;
		const summary = containerEl.createDiv({ cls: "geocode-export-summary" });
		summary.setText(
			count === 0
				? "No geocoded notes found in this vault yet."
				: `${count} geocoded note${count > 1 ? "s" : ""} available for export.`
		);

		for (const spec of EXPORT_FORMATS) {
			new Setting(containerEl)
				.setName(spec.label)
				.setDesc(spec.description)
				.addButton((btn) => {
					btn.setButtonText(`Export as ${spec.label}`)
						.setCta()
						.onClick(() => {
							this.plugin.exportGeocodedNotes(spec.format);
						});
				});
		}
	}
}
