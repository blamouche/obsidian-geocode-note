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
}

const DEFAULT_SETTINGS: GeocodeNoteSettings = {
	prefillSource: "none",
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

// --- Plugin ---
export default class GeocodeNotePlugin extends Plugin {
	settings: GeocodeNoteSettings = { ...DEFAULT_SETTINGS };

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
	}
}
