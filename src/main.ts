import { App, Modal, Notice, Plugin, setIcon, TFile, requestUrl } from "obsidian";

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

// --- Geocoding via Nominatim (OpenStreetMap) ---
async function geocodeAddress(address: string): Promise<{ lat: string; lon: string; display: string } | null> {
	const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=5`;
	const response = await requestUrl({ url });
	const results = response.json;
	if (results && results.length > 0) {
		return {
			lat: results[0].lat,
			lon: results[0].lon,
			display: results[0].display_name,
		};
	}
	return null;
}

// --- IP-based geolocation fallback (for desktop / Electron) ---
async function geolocateByIp(): Promise<{ lat: string; lon: string } | null> {
	try {
		const response = await requestUrl({ url: "https://ipapi.co/json/" });
		const data = response.json;
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

// --- Main Modal ---
class GeocodeModal extends Modal {
	private latitude = "";
	private longitude = "";
	private selectedIcon = "map-pin";
	private selectedColor = "red";
	private onSubmit: (lat: string, lon: string, icon: string, color: string) => void;

	// DOM refs for dynamic updates
	private coordDisplay: HTMLElement | null = null;
	private iconGrid: HTMLElement | null = null;
	private colorGrid: HTMLElement | null = null;
	private submitBtn: HTMLButtonElement | null = null;

	constructor(app: App, onSubmit: (lat: string, lon: string, icon: string, color: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("geocode-modal");

		// --- Title ---
		contentEl.createEl("h2", { text: "Geocode this note", cls: "geocode-modal-title" });

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
				doSearch();
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
			this.updateCoordDisplay();
			this.updateSubmitState();
		});
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
			this.onSubmit(this.latitude, this.longitude, this.selectedIcon, this.selectedColor);
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
	}

	private updateSubmitState() {
		if (!this.submitBtn) return;
		this.submitBtn.disabled = !(this.latitude && this.longitude);
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
		this.contentEl.empty();
	}
}

// --- Plugin ---
export default class GeocodeNotePlugin extends Plugin {
	onload(): void {
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

	private openGeocodeModal() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active note.");
			return;
		}

		new GeocodeModal(this.app, async (lat, lon, icon, color) => {
			await this.saveFrontmatter(file, lat, lon, icon, color);
			new Notice("Coordinates saved!");
		}).open();
	}

	private async saveFrontmatter(file: TFile, lat: string, lon: string, icon: string, color: string) {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter["coordinates"] = [lat, lon];
			frontmatter["icon"] = icon;
			frontmatter["color"] = color;
		});
	}
}
