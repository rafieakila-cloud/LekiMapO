import { AttributionControl, Map, Marker, Popup, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";

const mapElement = document.querySelector("#map");
const searchInput = document.querySelector("#place-search");
const searchResults = document.querySelector("#search-results");
const placeCard = document.querySelector("#place-card");
const toast = document.querySelector("#toast");
const savedDialog = document.querySelector("#saved-dialog");
const savedList = document.querySelector("#saved-list");
const MAX_SEARCH_RESULTS = 7;
const SAVED_PLACES_KEY = "lekimapo:saved-places:v1";

setWorkerUrl(workerUrl);

let searchTimer;
let searchController;
let detailController;
let activeRequest = 0;
let toastTimer;
let selectedMarker;
let selectedPopup;
let locationMarker;
let tiltEnabled = false;

const map = new Map({
  container: mapElement,
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [20, 20],
  zoom: 0.55,
  projection: { type: "globe" },
  attributionControl: false,
  canvasContextAttributes: { antialias: true },
});

map.addControl(new AttributionControl({ compact: true }), "bottom-right");

map.on("error", ({ error }) => {
  console.error("Kesalahan peta LekiMapO:", error);
  if (error?.message) showToast(`Peta: ${error.message}`);
});

map.on("load", () => {
  addBuildingExtrusions();
  document.querySelector(".map-shell").classList.add("map-ready");
  openSharedPlace();
});

map.on("style.load", addBuildingExtrusions);

map.on("rotate", () => {
  document.querySelector("#compass").style.transform = `rotate(${-map.getBearing()}deg)`;
});

map.on("click", (event) => {
  if (event.originalEvent.target.closest(".maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl")) return;
  const { lng, lat } = event.lngLat;
  const label = findPlaceLabel(event.point);
  const place = {
    name: label?.name || "Lokasi dipilih",
    city: label && ["city", "town", "village"].includes(label.className) ? label.name : "",
    region: label?.className === "state" ? label.name : "",
    country: "",
    lat,
    lon: lng,
    source: "titik peta",
  };
  if (!label) place.name = "Mencari nama tempat...";
  showPlace(place, { zoom: Math.max(map.getZoom(), 12) });
  reverseGeocode(lat, lng, place, activeRequest);
});

function findPlaceLabel(point) {
  const labelLayers = (map.getStyle()?.layers ?? [])
    .filter((layer) => layer.type === "symbol"
      && layer.layout?.["text-field"]
      && ["place", "poi"].includes(layer["source-layer"])
      && map.getLayer(layer.id))
    .map((layer) => layer.id);
  if (!labelLayers.length) return null;

  const features = map.queryRenderedFeatures(point, { layers: labelLayers });
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const name = properties.name_en || properties["name:latin"] || properties.name;
    if (typeof name !== "string" || !name.trim()) continue;
    return {
      name: name.trim(),
      className: properties.class || "",
    };
  }
  return null;
}

function addBuildingExtrusions() {
  const style = map.getStyle();
  if (!style?.sources?.openmaptiles) return;
  if (map.getLayer("building-3d")) {
    map.setPaintProperty("building-3d", "fill-extrusion-color", "#cad7cd");
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", 0.88);
    map.setPaintProperty("building-3d", "fill-extrusion-base", [
      "coalesce",
      ["to-number", ["get", "render_min_height"]],
      ["to-number", ["get", "min_height"]],
      0,
    ]);
    map.setPaintProperty("building-3d", "fill-extrusion-height", [
      "coalesce",
      ["to-number", ["get", "render_height"]],
      ["to-number", ["get", "height"]],
      ["*", ["to-number", ["get", "building:levels"]], 3],
      8,
    ]);
    return;
  }
  if (map.getLayer("lekimapo-3d-buildings")) return;
  const firstLabel = style.layers.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"]);
  map.addLayer({
    id: "lekimapo-3d-buildings",
    source: "openmaptiles",
    "source-layer": "building",
    type: "fill-extrusion",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": [
        "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "render_height"]], 8],
        0, "#e5e9e4",
        35, "#d0d9d4",
        100, "#becbc5",
      ],
      "fill-extrusion-height": [
        "interpolate", ["linear"], ["zoom"],
        13, 0,
        15, ["coalesce", ["to-number", ["get", "render_height"]], 8],
      ],
      "fill-extrusion-base": ["coalesce", ["to-number", ["get", "render_min_height"]], 0],
      "fill-extrusion-opacity": 0.88,
    },
  }, firstLabel?.id);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3300);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function resultDescription(feature) {
  const props = feature.properties;
  const name = resultTitle(feature).toLocaleLowerCase();
  const city = props.city?.toLocaleLowerCase();
  return [...new Set([props.city, props.district, props.county, props.state, props.country]
    .filter((part) => part && part.toLocaleLowerCase() !== name && part.toLocaleLowerCase() !== city))]
    .join(", ");
}

function resultTitle(feature) {
  const props = feature.properties;
  return props.name || props.street || props.city || props.country || "Tempat tanpa nama";
}

function featureToPlace(feature) {
  const props = feature.properties;
  const name = resultTitle(feature);
  return {
    name,
    city: props.city || (["city", "town"].includes(props.type) ? name : ""),
    district: props.district || props.locality || "",
    county: props.county || "",
    region: props.state || "",
    country: props.country || "",
    countryCode: props.countrycode || "",
    placeType: props.type || props.osm_value || "",
    lat: Number(feature.geometry.coordinates[1]),
    lon: Number(feature.geometry.coordinates[0]),
    source: "OpenStreetMap",
    extent: props.extent,
  };
}

function searchPriority(feature, query) {
  const properties = feature.properties;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedName = resultTitle(feature).toLocaleLowerCase();
  let score = normalizedName === normalizedQuery ? 100 : 0;
  if (properties.osm_value === "city") score += 50;
  else if (properties.osm_value === "town") score += 45;
  else if (properties.osm_value === "administrative") score += properties.type === "city" ? 30 : 10;
  else if (properties.osm_value === "village" && properties.type === "city") score += 20;
  return score;
}

function placeLocation(place) {
  const name = place.name?.toLocaleLowerCase();
  const specificLocality = [place.city, place.district]
    .some((part) => part && part.toLocaleLowerCase() !== name);
  return [...new Set([place.city, place.district, place.county, place.region, place.country]
    .filter((part, index) => part
      && (part.toLocaleLowerCase() !== name || (index === 2 && specificLocality))))]
    .join(", ") || place.country || place.source;
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchResults.hidden = true;
    searchResults.replaceChildren();
    return;
  }
  searchTimer = setTimeout(() => searchLocations(query), 340);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") searchResults.hidden = true;
  if (event.key === "Enter") {
    const first = searchResults.querySelector("[data-result-index]");
    if (first) first.click();
    else if (searchInput.value.trim().length > 1) searchLocations(searchInput.value.trim());
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) searchResults.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

async function searchLocations(query) {
  searchController?.abort();
  searchController = new AbortController();
  searchResults.hidden = false;
  searchResults.innerHTML = '<div class="search-hint"><span class="mini-spinner"></span> Mencari tempat di seluruh dunia...</div>';

  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(MAX_SEARCH_RESULTS * 2));
    url.searchParams.set("lang", "en");
    const response = await fetch(url, { signal: searchController.signal });
    if (!response.ok) throw new Error(`Layanan pencarian membalas ${response.status}`);
    const data = await response.json();
    if (searchInput.value.trim() !== query) return;

    const uniqueFeatures = [];
    const seenResults = new Set();
    for (const entry of (data.features ?? [])
      .map((feature, index) => ({ feature, index }))
      .sort((left, right) => searchPriority(right.feature, query) - searchPriority(left.feature, query)
        || left.index - right.index)) {
      const { feature } = entry;
      const place = featureToPlace(feature);
      const key = `${place.name.toLocaleLowerCase()}|${resultDescription(feature).toLocaleLowerCase()}`;
      if (seenResults.has(key)) continue;
      seenResults.add(key);
      uniqueFeatures.push(feature);
      if (uniqueFeatures.length >= MAX_SEARCH_RESULTS) break;
    }

    if (!uniqueFeatures.length) {
      searchResults.innerHTML = '<div class="search-hint">Tempat belum ditemukan. Coba ejaan atau nama kota lain.</div>';
      return;
    }

    searchResults.innerHTML = uniqueFeatures.map((feature, index) => {
      const place = featureToPlace(feature);
      return `<button class="search-result" type="button" data-result-index="${index}">
        <span class="result-pin">⌖</span>
        <span class="result-copy"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(resultDescription(feature) || place.placeType || "Lokasi di OpenStreetMap")}</small></span>
        <span class="result-arrow">↗</span>
      </button>`;
    }).join("");

    searchResults.querySelectorAll("[data-result-index]").forEach((button, index) => {
      button.addEventListener("click", () => {
        const place = featureToPlace(uniqueFeatures[index]);
        searchInput.value = place.name;
        searchResults.hidden = true;
        showPlace(place, { zoom: place.extent ? 12 : 14 });
      });
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Pencarian tempat gagal:", error);
    searchResults.innerHTML = '<div class="search-hint">Pencarian belum tersedia. Periksa koneksi internet, lalu coba lagi.</div>';
  }
}

async function reverseGeocode(lat, lon, selectedPlace = {}, requestId = activeRequest) {
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Layanan lokasi membalas ${response.status}`);
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return;

    if (requestId !== activeRequest) return;
    const resolved = featureToPlace(feature);
    const keepSelectedName = selectedPlace.name
      && !["Lokasi dipilih", "Mencari nama tempat..."].includes(selectedPlace.name);
    await showPlace({
      ...resolved,
      ...selectedPlace,
      name: keepSelectedName ? selectedPlace.name : resolved.name,
      city: selectedPlace.city || resolved.city,
      district: resolved.district || selectedPlace.district,
      county: resolved.county || selectedPlace.county,
      region: selectedPlace.region || resolved.region,
      country: selectedPlace.country || resolved.country,
      lat,
      lon,
      source: "titik peta",
    }, { moveMap: false });
  } catch (error) {
    console.error("Nama lokasi belum dapat ditemukan:", error);
    if (requestId === activeRequest) showToast("Nama tempat belum ditemukan. Coba cari kotanya.");
  }
}

function distanceInKilometers(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDifference = radians(lat2 - lat1);
  const longitudeDifference = radians(lon2 - lon1);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

async function getWikipediaSummary(place, signal) {
  const names = [...new Set([place.name, place.city].filter(Boolean))];
  let bestMatch = null;
  let bestTitleRank = Infinity;
  let bestDistance = Infinity;
  for (const language of ["id", "en"]) {
    for (const name of names) {
      const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
      url.search = new URLSearchParams({
        action: "query",
        titles: name,
        redirects: "1",
        prop: "extracts|pageimages|info|coordinates",
        inprop: "url",
        exintro: "1",
        explaintext: "1",
        piprop: "thumbnail",
        pithumbsize: "900",
        format: "json",
        origin: "*",
      });
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Wikipedia membalas ${response.status}`);
      const data = await response.json();
      const page = Object.values(data.query?.pages ?? {})[0];
      const coordinate = page?.coordinates?.[0];
      if (!page?.extract || !coordinate) continue;

      const titleRank = names.reduce((bestRank, candidate) => {
        const title = page.title.toLocaleLowerCase();
        const normalizedName = candidate.toLocaleLowerCase();
        if (title === normalizedName) return Math.min(bestRank, 0);
        if (title.startsWith(`${normalizedName} `)) return Math.min(bestRank, 1);
        if (title.endsWith(` ${normalizedName}`)) return Math.min(bestRank, 2);
        return bestRank;
      }, Infinity);
      const distance = distanceInKilometers(place.lat, place.lon, coordinate.lat, coordinate.lon);
      if (titleRank < Infinity && distance <= 60
        && (titleRank < bestTitleRank || (titleRank === bestTitleRank && distance < bestDistance))) {
        bestMatch = page;
        bestTitleRank = titleRank;
        bestDistance = distance;
      }
    }
  }
  return bestMatch;
}

async function getNearbyFood(place, signal) {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(place.lat));
  url.searchParams.set("lon", String(place.lon));
  url.searchParams.set("radius", "8");
  url.searchParams.set("limit", "20");
  for (const type of ["restaurant", "cafe", "fast_food", "food_court", "ice_cream"]) {
    url.searchParams.append("osm_tag", `amenity:${type}`);
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Pencarian kuliner membalas ${response.status}`);
  const data = await response.json();
  const restaurants = [];
  const seen = new Set();
  for (const feature of data.features ?? []) {
    const item = featureToPlace(feature);
    const distance = distanceInKilometers(place.lat, place.lon, item.lat, item.lon);
    const countryMatches = !place.countryCode || !item.countryCode
      || place.countryCode.toLocaleLowerCase() === item.countryCode.toLocaleLowerCase();
    const name = item.name.toLocaleLowerCase();
    if (!feature.properties.name || distance > 8 || !countryMatches || seen.has(name)) continue;
    seen.add(name);
    restaurants.push({
      ...item,
      cuisine: feature.properties.extra?.cuisine || "",
      amenity: feature.properties.osm_value || "restaurant",
      distance,
      osmType: feature.properties.osm_type,
      osmId: feature.properties.osm_id,
    });
  }
  return restaurants.sort((left, right) => left.distance - right.distance).slice(0, 6);
}

async function getWeather(place, signal) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    timezone: "auto",
    forecast_days: "1",
  });
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Layanan cuaca membalas ${response.status}`);
  const data = await response.json();
  if (!data.current || !data.timezone) throw new Error("Data cuaca untuk lokasi ini belum tersedia.");
  return {
    ...data.current,
    timezone: data.timezone,
  };
}

function getWeatherDescription(code) {
  if (code === 0) return "Cerah";
  if (code === 1) return "Cerah berawan";
  if (code === 2) return "Berawan sebagian";
  if (code === 3) return "Berawan";
  if ([45, 48].includes(code)) return "Berkabut";
  if ([51, 53, 55, 56, 57].includes(code)) return "Gerimis";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Hujan";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Salju";
  if ([95, 96, 99].includes(code)) return "Badai petir";
  return "Kondisi cuaca tersedia";
}

function readSavedPlaces() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_PLACES_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.error("Daftar tempat tersimpan tidak dapat dibaca:", error);
    return [];
  }
}

function isPlaceSaved(place) {
  return readSavedPlaces().some((saved) => saved.lat === place.lat && saved.lon === place.lon);
}

function toggleSavedPlace(place) {
  try {
    const saved = readSavedPlaces();
    const existingIndex = saved.findIndex((item) => item.lat === place.lat && item.lon === place.lon);
    if (existingIndex >= 0) saved.splice(existingIndex, 1);
    else saved.unshift({
      name: place.name,
      city: place.city,
      district: place.district,
      county: place.county,
      region: place.region,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lon: place.lon,
      placeType: place.placeType,
    });
    localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(saved.slice(0, 50)));
    renderSavedPlaces();
    renderSaveButton(place);
    showToast(existingIndex >= 0 ? "Tempat dihapus dari koleksi." : "Tempat disimpan di perangkat ini.");
  } catch (error) {
    console.error("Tempat belum dapat disimpan:", error);
    showToast("Tempat tidak dapat disimpan. Periksa ruang penyimpanan browser.");
  }
}

function renderSaveButton(place) {
  const button = document.querySelector("#save-place");
  if (!button) return;
  const saved = isPlaceSaved(place);
  button.classList.toggle("saved", saved);
  button.textContent = saved ? "★ Tersimpan" : "☆ Simpan tempat";
  button.setAttribute("aria-pressed", String(saved));
}

function renderSavedPlaces() {
  const saved = readSavedPlaces();
  savedList.innerHTML = saved.length
    ? saved.map((place, index) => `
        <button class="saved-place" type="button" data-saved-index="${index}">
          <span class="saved-pin">⌖</span>
          <span><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(placeLocation(place))}</small></span>
          <span class="saved-arrow">↗</span>
        </button>
      `).join("")
    : '<p class="saved-empty">Tempat favoritmu tersimpan di perangkat ini.</p>';
  savedList.querySelectorAll("[data-saved-index]").forEach((button, index) => {
    button.addEventListener("click", () => {
      savedDialog.close();
      const place = readSavedPlaces()[index];
      if (place) showPlace(place, { zoom: 14 });
    });
  });
}

function formatDistance(distance) {
  return distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m` : `${distance.toFixed(1)} km`;
}

async function getCuisineReads(place, signal) {
  const locations = [...new Set([place.name, place.region, place.country].filter(Boolean))];
  const candidates = locations.map((location) => ({
    base: "https://en.wikipedia.org/w/api.php",
    query: `${location} cuisine food`,
    location,
  }));
  const usedTitles = new Set();
  const pages = [];

  for (const candidate of candidates) {
    if (pages.length >= 2) break;
    const url = new URL(candidate.base);
    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: candidate.query,
      gsrnamespace: "0",
      gsrlimit: "6",
      prop: "extracts|pageimages|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      piprop: "thumbnail",
      pithumbsize: "500",
      format: "json",
      origin: "*",
    });
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Wikipedia membalas ${response.status}`);
    const data = await response.json();
    const locationTerm = candidate.location.toLocaleLowerCase();
    const matches = Object.values(data.query?.pages ?? {})
      .filter((page) => {
        const title = page.title.toLocaleLowerCase();
        const topicIsFood = /(cuisine|food|dish|culinary|gastronom|kuliner)/.test(title)
          && !/(festival|fair|competition|company|restaurant chain)/.test(title);
        const mentionsLocation = title.includes(locationTerm)
          || title.includes(locationTerm.replace(/ province$/i, ""));
        return page.extract && topicIsFood && mentionsLocation && !usedTitles.has(page.title);
      })
      .slice(0, 2 - pages.length);
    for (const page of matches) {
      usedTitles.add(page.title);
      pages.push(page);
    }
  }
  return pages;
}

function compactExtract(value = "", maxLength = 400) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

function setLoadingCard(place) {
  placeCard.innerHTML = `
    <button class="card-back" id="card-back" type="button" aria-label="Kembali ke peta">↶</button>
    <div class="loading-place">
      <span class="card-kicker"><span class="live-dot"></span> SEDANG DIJELAJAHI</span>
      <h2>${escapeHtml(place.name)}</h2>
      <p>${escapeHtml(placeLocation(place))}</p>
      <div class="shimmer shimmer-image"></div>
      <div class="shimmer shimmer-line"></div>
      <div class="shimmer shimmer-line short"></div>
      <div class="shimmer shimmer-food"></div>
    </div>
  `;
  document.querySelector("#card-back").addEventListener("click", returnToMap);
}

async function showPlace(place, options = {}) {
  const requestId = ++activeRequest;
  detailController?.abort();
  detailController = new AbortController();
  setLoadingCard(place);
  searchResults.hidden = true;

  if (options.moveMap !== false) {
    selectedMarker?.remove();
    const markerElement = document.createElement("div");
    markerElement.className = "place-marker";
    selectedPopup?.remove();
    selectedMarker = new Marker({ element: markerElement, anchor: "bottom" })
    .setLngLat([place.lon, place.lat])
    .addTo(map);
    selectedPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 19, maxWidth: "230px" })
    .setLngLat([place.lon, place.lat])
    .setHTML(`<div class="location-popup"><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(placeLocation(place))}</span></div>`)
    .addTo(map);
    tiltEnabled = true;
    const tiltButton = document.querySelector("#tilt-button");
    tiltButton.classList.add("selected");
    tiltButton.textContent = "2D";
    tiltButton.title = "Kembalikan tampilan 2D";
    tiltButton.setAttribute("aria-label", "Kembalikan tampilan 2D");
    map.flyTo({
      center: [place.lon, place.lat],
      zoom: options.zoom ?? 14.2,
      pitch: tiltEnabled ? 57 : 38,
      bearing: -18,
      duration: 2000,
      essential: true,
    });
  }

  const signal = detailController.signal;
  const results = await Promise.allSettled([
    getWikipediaSummary(place, signal),
    getCuisineReads(place, signal),
    getNearbyFood(place, signal),
    getWeather(place, signal),
  ]);
  if (requestId !== activeRequest) return;
  const [summaryResult, cuisineResult, nearbyResult, weatherResult] = results;
  for (const [label, result] of [
    ["Ringkasan tempat", summaryResult],
    ["Artikel kuliner", cuisineResult],
    ["Tempat makan sekitar", nearbyResult],
    ["Cuaca", weatherResult],
  ]) {
    if (result.status === "rejected" && result.reason.name !== "AbortError") {
      console.error(`${label} belum dapat dimuat:`, result.reason);
    }
  }
  renderPlaceCard(place, {
    summary: summaryResult.status === "fulfilled" ? summaryResult.value : null,
    cuisine: cuisineResult.status === "fulfilled" ? cuisineResult.value : [],
    nearby: nearbyResult.status === "fulfilled" ? nearbyResult.value : [],
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    errors: {
      summary: summaryResult.status === "rejected" ? summaryResult.reason : null,
      cuisine: cuisineResult.status === "rejected" ? cuisineResult.reason : null,
      nearby: nearbyResult.status === "rejected" ? nearbyResult.reason : null,
      weather: weatherResult.status === "rejected" ? weatherResult.reason : null,
    },
  });
}

function renderPlaceCard(place, details) {
  const { summary, cuisine, nearby, weather, errors } = details;
  const displayName = summary?.title || place.name;
  const image = summary?.thumbnail?.source;
  const summaryText = summary?.extract;
  const foodQuery = encodeURIComponent(`${place.city || place.name} ${place.country || ""} local food cuisine`);
  const weatherTime = weather
    ? new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: weather.timezone,
    }).format(new Date(weather.time))
    : "";

  placeCard.innerHTML = `
    <button class="card-back" id="card-back" type="button" aria-label="Kembali ke peta">↶</button>
    <div class="place-scroll">
      <span class="card-kicker"><span class="live-dot"></span> TEMPAT DIJELAJAHI</span>
      <h2>${escapeHtml(displayName)}</h2>
      <p class="place-subtitle">${escapeHtml(placeLocation(place))}</p>
      ${image
        ? `<div class="place-photo"><img src="${escapeHtml(image)}" alt="${escapeHtml(displayName)}" /><span>FOTO · WIKIPEDIA</span></div>`
        : `<div class="photo-placeholder"><span>⌖</span><strong>Temukan tempatnya di peta</strong><small>Foto belum tersedia untuk lokasi ini.</small></div>`}
      <div class="place-actions">
        <button id="save-place" class="save-place-button" type="button" aria-pressed="false">☆ Simpan tempat</button>
        <button id="share-place" class="share-place-button" type="button">↗ Bagikan</button>
      </div>
      <section class="weather-card">
        ${weather
          ? `<span class="weather-icon">${weather.weather_code >= 95 ? "⛈" : weather.weather_code >= 51 ? "☂" : weather.weather_code >= 2 ? "☁" : "☀"}</span>
             <div class="weather-main"><span class="section-label">CUACA LOKAL · ${escapeHtml(weatherTime)}</span><strong>${escapeHtml(getWeatherDescription(weather.weather_code))}</strong><small>Terasa ${escapeHtml(String(weather.apparent_temperature))}° · Kelembapan ${escapeHtml(String(weather.relative_humidity_2m))}%</small></div>
             <span class="weather-temperature">${escapeHtml(String(weather.temperature_2m))}°</span>`
          : `<span class="weather-icon">☁</span><div class="weather-main"><span class="section-label">CUACA LOKAL</span><strong>Cuaca belum tersedia</strong><small>${errors.weather ? "Periksa koneksi internet lalu coba lagi." : "Belum ada data untuk lokasi ini."}</small></div>`}
      </section>
      <section class="info-section">
        <span class="section-label">CERITA TEMPAT</span>
        <p class="description">${escapeHtml(compactExtract(summaryText || (errors.summary
          ? "Ringkasan lokasi tidak dapat dimuat. Coba lagi setelah koneksi pulih."
          : "Belum ada artikel ensiklopedia yang cocok dengan tempat ini. Info yang tampil tidak akan diganti dengan kota lain."), 650))}</p>
        ${summary?.fullurl ? `<a class="source-link" href="${escapeHtml(summary.fullurl)}" target="_blank" rel="noreferrer">Baca selengkapnya <span>↗</span></a>` : ""}
      </section>
      <section class="food-section">
        <div class="section-heading"><span class="food-icon">✳</span><div><span class="section-label">RASA LOKAL</span><h3>Kuliner di sekitar</h3></div></div>
        ${nearby.length
          ? nearby.map((item, index) => `<button class="food-item food-place" type="button" data-food-index="${index}">
              <span class="food-placeholder">✳</span>
              <span class="food-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.cuisine, item.amenity.replaceAll("_", " "), formatDistance(item.distance)].filter(Boolean).join(" · "))}</small></span>
              <span class="food-arrow">↗</span>
            </button>`).join("")
          : `<p class="no-food">${errors.nearby ? "Tempat makan sekitar belum dapat dimuat." : "Belum ada tempat makan bernama yang tercatat dekat lokasi ini."}</p>`}
        ${cuisine.length
          ? cuisine.map((page) => `<a class="food-item" href="${escapeHtml(page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`)}" target="_blank" rel="noreferrer">
              ${page.thumbnail?.source ? `<img src="${escapeHtml(page.thumbnail.source)}" alt="" loading="lazy" />` : '<span class="food-placeholder">✳</span>'}
              <span class="food-copy"><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(compactExtract(page.extract, 115))}</small></span>
              <span class="food-arrow">↗</span>
            </a>`).join("")
          : `<p class="no-food">${errors.cuisine ? "Artikel kuliner belum dapat dimuat." : "Belum ada artikel kuliner khusus untuk wilayah ini."}</p>`}
        <a class="food-search" href="https://en.wikivoyage.org/w/index.php?search=${foodQuery}" target="_blank" rel="noreferrer">Jelajahi kuliner sekitar <span>↗</span></a>
      </section>
      <footer class="place-footer">Peta: © OpenStreetMap · Artikel: Wikipedia · Cuaca: Open-Meteo <span>·</span> Bangunan 3D bukan real-time</footer>
    </div>
  `;

  renderSaveButton(place);
  document.querySelector("#save-place").addEventListener("click", () => toggleSavedPlace(place));
  document.querySelector("#share-place").addEventListener("click", () => sharePlace(place));
  document.querySelectorAll("[data-food-index]").forEach((button, index) => {
    button.addEventListener("click", () => showPlace(nearby[index], { zoom: 16 }));
  });
  document.querySelector("#card-back").addEventListener("click", returnToMap);
}

async function sharePlace(place) {
  const url = new URL(window.location.href);
  for (const key of ["lat", "lon", "name", "city", "district", "county", "region", "country", "countryCode", "placeType"]) {
    if (place[key] !== undefined && place[key] !== "") url.searchParams.set(key, String(place[key]));
  }
  try {
    if (navigator.share) await navigator.share({ title: `${place.name} · LekiMapO`, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      showToast("Tautan lokasi disalin.");
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Tautan lokasi belum dapat dibagikan:", error);
    showToast("Tautan belum dapat dibagikan dari browser ini.");
  }
}

function returnToMap() {
  activeRequest++;
  detailController?.abort();
  selectedMarker?.remove();
  selectedPopup?.remove();
  selectedMarker = null;
  selectedPopup = null;
  tiltEnabled = false;
  const tiltButton = document.querySelector("#tilt-button");
  tiltButton.classList.remove("selected");
  tiltButton.textContent = "3D";
  tiltButton.title = "Aktifkan tampilan 3D";
  tiltButton.setAttribute("aria-label", "Aktifkan tampilan 3D");
  map.flyTo({ center: [20, 20], zoom: 1.65, pitch: 0, bearing: 0, duration: 1800 });
  placeCard.innerHTML = `
    <div class="card-loading">
      <span class="card-kicker"><span class="live-dot"></span> PENJELAJAHAN DUNIA</span>
      <h1>Dunia, lebih<br /><span>dekat.</span></h1>
      <p>Jelajahi kota di seluruh dunia. Pilih titik di peta atau cari tempat untuk melihat kisah, foto, kuliner, dan cuaca lokal.</p>
      <button id="explore-jakarta" class="discover-link" type="button">Jelajahi Jakarta <span>↗</span></button>
    </div>
  `;
  document.querySelector("#explore-jakarta").addEventListener("click", () => goToJakarta());
}

function goToJakarta() {
  showPlace({
    name: "Jakarta",
    city: "Jakarta",
    country: "Indonesia",
    lat: -6.1754,
    lon: 106.8272,
    source: "LekiMapO",
  }, { zoom: 13.4 });
}

document.querySelector("#explore-jakarta").addEventListener("click", goToJakarta);
document.querySelector("#zoom-in").addEventListener("click", () => map.zoomIn({ duration: 350 }));
document.querySelector("#zoom-out").addEventListener("click", () => map.zoomOut({ duration: 350 }));
document.querySelector("#compass").addEventListener("click", () => map.easeTo({ bearing: 0, pitch: tiltEnabled ? 55 : 0, duration: 650 }));

document.querySelector("#tilt-button").addEventListener("click", (event) => {
  tiltEnabled = !tiltEnabled;
  const button = event.currentTarget;
  button.classList.toggle("selected", tiltEnabled);
  button.textContent = tiltEnabled ? "2D" : "3D";
  button.title = tiltEnabled ? "Kembalikan tampilan 2D" : "Aktifkan tampilan 3D";
  button.setAttribute("aria-label", button.title);
  map.easeTo({ pitch: tiltEnabled ? 58 : 0, duration: 700 });
});

document.querySelector("#locate-button").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Browser ini belum mendukung lokasi perangkat.");
    return;
  }
  showToast("Meminta izin lokasi perangkat...");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const { latitude, longitude } = coords;
      locationMarker?.remove();
      const element = document.createElement("div");
      element.className = "user-location-marker";
      locationMarker = new Marker({ element })
        .setLngLat([longitude, latitude])
        .addTo(map);
      showPlace({
        name: "Lokasi saya",
        city: "",
        country: "",
        lat: latitude,
        lon: longitude,
        source: "perangkat ini",
      }, { zoom: 15 });
      showToast("Lokasimu ditampilkan hanya di perangkat ini.");
    },
    (error) => {
      console.error("Lokasi perangkat tidak tersedia:", error);
      showToast(error.code === 1 ? "Izin lokasi ditolak. Aktifkan izin lokasi di browser." : "Lokasi belum tersedia. Coba lagi di luar ruangan.");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
});

document.querySelector("#explore-tab").addEventListener("click", returnToMap);
document.querySelector("#saved-button").addEventListener("click", () => {
  renderSavedPlaces();
  savedDialog.showModal();
});
savedDialog.querySelector("[data-close]").addEventListener("click", () => savedDialog.close());
savedDialog.addEventListener("click", (event) => {
  if (event.target === savedDialog) savedDialog.close();
});

function openSharedPlace() {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const name = params.get("name");
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  const place = { name, lat, lon, source: "tautan LekiMapO" };
  for (const key of ["city", "district", "county", "region", "country", "countryCode", "placeType"]) {
    const value = params.get(key);
    if (value) place[key] = value;
  }
  showPlace(place, { zoom: 14 });
}

window.addEventListener("online", () => showToast("Koneksi internet pulih."));
window.addEventListener("offline", () => showToast("Kamu sedang offline. Peta online mungkin tidak tersedia."));

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
    console.error("Service worker tidak dapat didaftarkan:", error);
  }));
}
